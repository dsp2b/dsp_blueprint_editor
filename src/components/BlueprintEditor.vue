<template>
	<div class="editor-root" ref="root" tabindex="-1">
		<template v-if="loaded">
			<div v-show="tip.visible" class="hover-tip" role="tooltip"
				:style="{ left: `${tip.x}px`, top: `${tip.y}px` }">{{ tip.text }}</div>

			<div class="view-tools" role="toolbar" :aria-label="t('视图工具')">
				<div class="mode-seg" role="group" :aria-label="t('显示模式')">
					<button type="button" :aria-pressed="mode === 'box'" :title="t('精简说明')" @click="setMode('box')">
						{{ t('精简') }}
					</button>
					<button type="button" :aria-pressed="mode === 'model'" :title="t('真实模型说明')" @click="setMode('model')">
						{{ t('真实模型') }}
					</button>
				</div>
				<button type="button" class="tool" :title="`${t('对准蓝图')} (F)`" aria-keyshortcuts="F" @click="frameBlueprint()">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
					<span class="label">{{ t('对准蓝图') }}</span>
				</button>
				<button type="button" class="tool" :title="`${t('俯视')} (T)`" aria-keyshortcuts="T" @click="topView()">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>
					<span class="label">{{ t('俯视') }}</span>
				</button>
				<button type="button" class="tool" :aria-pressed="settings.badges" :title="t('配方标记说明')"
					@click="settings.badges = !settings.badges">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M13 7.5h7M4 16.5h7"/></svg>
					<span class="label">{{ t('配方标记') }}</span>
				</button>
				<button type="button" class="tool" :aria-pressed="flowOn" :disabled="reducedMotion"
					:title="reducedMotion ? t('流向已停') : t('流向说明')" @click="settings.flow = !settings.flow">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12h14M13 7l5 5-5 5"/></svg>
					<span class="label">{{ t('流向') }}</span>
				</button>
			</div>

			<button type="button" class="tool tool-shot" :title="t('截图说明')" @click="screenshot()">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
				<span class="label">{{ t('截图') }}</span>
			</button>

			<div class="legend" role="list" :aria-label="t('等级图例')">
				<span v-for="tier of tiers" :key="tier.name" role="listitem">
					<i :style="{ background: tier.color }"></i>{{ tier.name }}
				</span>
			</div>
		</template>
	</div>
</template>

<script lang="ts">
import { Group, LineSegments, LineBasicMaterial } from 'three';
import { SphereLatitudeGridGeometry, SphereLongitudeGridGeometry } from '@/SphereGridGeometry';
import { gridAreas } from '@/blueprint/planet';

function buildPlanetGrid(radius = 1, segment = 200) {
	const allGrids = new Group();
	const material = new LineBasicMaterial( { color: 0x3E5B7C, transparent: true, opacity: 0.35, depthWrite: false } );

	const latitudeGeometry = new SphereLatitudeGridGeometry({
		radius,
		widthSegments: segment,
		heightSegments: segment / 2
	});
	allGrids.add(new LineSegments(latitudeGeometry, material));

	const radPerSeg = 2 * Math.PI / segment;
	for (const {minLatitudeSeg, latitudeSeg, longitudeSeg} of gridAreas(segment)) {
		const geometry = new SphereLongitudeGridGeometry({
			radius,
			widthSegments: longitudeSeg, heightSegments: Math.abs(latitudeSeg),
			phiStart: 0, phiLength: Math.PI * 2,
			thetaStart: (minLatitudeSeg + segment / 4) * radPerSeg, thetaLength: latitudeSeg * radPerSeg,
		});
		allGrids.add(new LineSegments(geometry, material));
	}
	return allGrids;
}

const R = 200.2;
const SEGMENT = 200;
/** "对准蓝图"的俯仰角；蓝图大到要拉得很远时改为正俯视 */
const FRAME_TILT = 40 / 180 * Math.PI;
const FLATTEN_BEYOND = R * 0.6;
const CLICK_SLOP = 5;
</script>

<script setup lang="ts">
import { ref, reactive, onMounted, Ref, onUnmounted, watchEffect, computed, inject, watch, nextTick, shallowRef, toRaw } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	Scene, PerspectiveCamera, SphereGeometry, Mesh, MeshStandardMaterial, WebGLRenderer, DirectionalLight,
	HemisphereLight, Matrix4, Object3D, Vector3,
} from 'three';
import { PlanetMapControls } from '@/PlanetMapControls';
import { attachCamera, attachRenderer } from '@/utils';
import { findPosForAreas, calcBuildingTrans } from '@/blueprint/planet';
import { commandQueueKey } from '@/define';
import { sessionKey } from '@/open/keys';
import { DisplayMode, browserConnection, defaultSettings, resolveDisplayMode, settingsKey } from '@/settings';
import { itemName, recipeName } from '@/i18n';
import { LayerInstance, layerRegistry, layerVisibility, ViewState } from '@/render/layers';
import { buildBadges, registerIconUpdater } from '@/render/core/badges';
import { buildBVH, pickBuilding } from '@/render/core/pick';
import { blueprintBoundsPoints, frameBounds } from '@/render/core/framing';
import { CameraRig } from '@/render/core/cameraRig';
import { SelectionMarker } from '@/render/core/selection';
import { HighlightFilter, highlightMask } from '@/render/core/filter';
import { TIER_HEX } from '@/render/core/tiers';

const props = defineProps<{
  selectedBuildingIndex: number | null,
}>();

const emit = defineEmits<{
  (e: 'update:selectedBuildingIndex', index: number | null): void
}>()

const { t } = useI18n();
const settings = inject(settingsKey, () => reactive(defaultSettings()), true);
const session = inject(sessionKey, null);
const commandQueue = inject(commandQueueKey)!;

const tiers = ([1, 2, 3] as const).map(k => ({
	name: `Mk.${'I'.repeat(k)}`,
	color: `#${TIER_HEX[k].toString(16).padStart(6, '0')}`,
}));

// ───────── 减少动态效果 ─────────
const motionQuery = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = ref(motionQuery?.matches ?? false);
const onMotionChange = (e: MediaQueryListEvent) => { reducedMotion.value = e.matches; };
motionQuery?.addEventListener('change', onMotionChange);
onUnmounted(() => motionQuery?.removeEventListener('change', onMotionChange));

const flowOn = computed(() => settings.flow && !reducedMotion.value);
const view: ViewState = reactive({ flow: true, badges: true, reducedMotion: false });
watchEffect(() => {
	view.flow = flowOn.value;
	view.badges = settings.badges;
	view.reducedMotion = reducedMotion.value;
});

// ───────── 场景 ─────────
const scene = new Scene();
const hemiLight = new HemisphereLight(0xCFE3FF, 0x0D1828, 1.1);
scene.add(hemiLight);
const sun = new DirectionalLight(0xFFF1DE, 2.2);
const sunTarget = new Object3D();
sun.target = sunTarget;
scene.add(sun, sunTarget);
{
	const geometry = new SphereGeometry(R, SEGMENT, SEGMENT / 2);
	const material = new MeshStandardMaterial( { color: 0x223349, roughness: 1 } );
	const planet = new Mesh(geometry, material);
	scene.add(planet);
}
const planetGrid = buildPlanetGrid(R * 1.0001, SEGMENT);
scene.add(planetGrid);
watchEffect(() => { planetGrid.visible = settings.grid; });

const selection = new SelectionMarker();
scene.add(selection.group);

const root: Ref<HTMLDivElement | null> = ref(null);
// preserveDrawingBuffer：截图时画布内容仍在
const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
attachRenderer(root, renderer);

const camera = new PerspectiveCamera(50);
camera.near = 0.5;
camera.far = 3000;
camera.position.z = 2 * R;
attachCamera(root, camera);

// ───────── 每个蓝图的图层 ─────────
interface Built {
	root: Group;
	layers: LayerInstance[];
	badges: ReturnType<typeof buildBadges>;
	bvh: ReturnType<typeof buildBVH>;
	transforms: Matrix4[][];
	bounds: Vector3[];
}

const b = computed<Built | null>(() => {
	if (!commandQueue.value)
		return null;
	const d = commandQueue.value.data;
	const pos = findPosForAreas(d.areas, SEGMENT);
	const transforms = d.buildings.map(b => calcBuildingTrans(R, pos, b));
	const group = new Group();
	const badges = buildBadges(renderer, d.buildings, transforms);
	const layers = layerRegistry.map(entry => {
		const layer = entry.create();
		const layerRoot = new Group();
		layerRoot.name = entry.id;
		group.add(layerRoot);
		layer.build({
			root: layerRoot, renderer, R, data: d, buildings: d.buildings, transforms,
			// 传原始对象：build 里读取显示状态不应让这个 computed 依赖它
			icons: badges.icons, iconTexture: badges.iconTexture, view: toRaw(view),
		});
		return { entry, layer };
	});
	group.add(badges.group);
	registerIconUpdater(commandQueue.value.updater, badges, R, pos);
	return {
		root: group, layers, badges, transforms,
		bvh: buildBVH(transforms, d.buildings),
		bounds: blueprintBoundsPoints(d.buildings, transforms),
	};
});
const loaded = computed(() => b.value !== null);

watchEffect(onCleanUp => {
	const built = b.value;
	if (built === null)
		return;
	scene.add(built.root);
	onCleanUp(() => {
		scene.remove(built.root);
		for (const { layer } of built.layers)
			layer.dispose();
		built.badges.dispose();
	});
});

// ───────── 显示模式 ─────────
const mode = ref<DisplayMode>(resolveDisplayMode(browserConnection(), settings));
const setMode = (m: DisplayMode) => {
	mode.value = m;
	settings.viewMode = m;
};
let shownVisibility: boolean[] = [];
const applyVisibility = (built: Built) => {
	const vis = layerVisibility(built.layers, mode.value);
	vis.forEach((v, i) => {
		if (shownVisibility[i] !== v)
			built.layers[i].layer.setVisible(v);
	});
	shownVisibility = vis;
};
watch(b, () => { shownVisibility = []; });
watchEffect(() => {
	if (b.value)
		b.value.badges.group.visible = settings.badges;
});

// ───────── 悬停 / 选中 / 高亮 ─────────
const hovered = ref<number | null>(null);
/** selectAll 选中的同类建筑（描边，无光环） */
const multi = shallowRef<ReadonlySet<number>>(new Set());
const filter = shallowRef<HighlightFilter>(null);

watchEffect(() => {
	const built = b.value;
	if (!built)
		return;
	for (const { layer } of built.layers)
		layer.setHover?.(hovered.value);
});
watchEffect(() => {
	const built = b.value;
	const primary = props.selectedBuildingIndex;
	if (!built || !commandQueue.value) {
		selection.clear();
		return;
	}
	const indices = new Set(multi.value);
	if (primary !== null)
		indices.add(primary);
	selection.set(built.bvh.boxes, commandQueue.value.data.buildings, built.transforms, indices, primary);
	for (const { layer } of built.layers)
		layer.setSelected?.(indices);
});
watchEffect(() => {
	const built = b.value;
	if (!built || !commandQueue.value)
		return;
	const mask = highlightMask(commandQueue.value.data.buildings, filter.value);
	for (const { layer } of built.layers)
		layer.setHighlight?.(mask);
	built.badges.icons.setDim(mask ? bd => !mask[bd.index] : null);
});

/** 高亮匹配的建筑并淡化其余建筑；传 null 取消。返回匹配的数量 */
const highlight = (f: HighlightFilter) => {
	filter.value = f;
	const mask = commandQueue.value ? highlightMask(commandQueue.value.data.buildings, f) : null;
	return mask ? mask.reduce((n, v) => n + v, 0) : 0;
};

/** 选中（描边）并高亮所有同类建筑，返回它们的 index */
const selectAll = (itemId: number) => {
	const buildings = commandQueue.value?.data.buildings ?? [];
	const indices = buildings.filter(bd => bd.itemId === itemId).map(bd => bd.index);
	multi.value = new Set(indices);
	filter.value = indices.length ? { itemId } : null;
	return indices;
};

const deselect = () => {
	multi.value = new Set();
	emit('update:selectedBuildingIndex', null);
};

// ───────── 相机 ─────────
let rig: CameraRig | null = null;
let controls: PlanetMapControls | null = null;

const fit = (tilt: number) => {
	const built = b.value;
	if (!built || !rig || !controls || built.bounds.length === 0)
		return false;
	const f = frameBounds(built.bounds, {
		R, fov: camera.fov, aspect: camera.aspect, tilt,
		minDistance: controls.minDistance - R, maxDistance: controls.maxDistance - R,
		flattenBeyond: FLATTEN_BEYOND,
	});
	rig.flyTo(f.base, f.tilt, reducedMotion.value);
	return true;
};
/** 让相机框住整个蓝图（F）；减少动态效果时直接跳过去 */
const frameBlueprint = () => fit(FRAME_TILT);
/** 正俯视整个蓝图（T） */
const topView = () => fit(0);

let frameOnBuild = false;
const offOpened = session?.onOpened(() => {
	frameOnBuild = true;
	hovered.value = null;
	multi.value = new Set();
	filter.value = null;
	mode.value = resolveDisplayMode(browserConnection(), settings);
	nextTick(() => {
		if (frameOnBuild && rig)
			frameOnBuild = !frameBlueprint();
	});
});
onUnmounted(() => offOpened?.());

// ───────── 截图 ─────────
const screenshot = () => {
	const src = renderer.domElement;
	const canvas = document.createElement('canvas');
	canvas.width = src.width;
	canvas.height = src.height;
	const ctx2d = canvas.getContext('2d');
	if (!ctx2d)
		return;
	ctx2d.fillStyle = '#0E1726';
	ctx2d.fillRect(0, 0, canvas.width, canvas.height);
	ctx2d.drawImage(src, 0, 0);
	const name = (commandQueue.value?.data.header.shortDesc.trim() || 'blueprint') + '.png';
	canvas.toBlob(blob => {
		if (!blob)
			return;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}, 'image/png');
};

// ───────── 画布描述（屏幕阅读器） ─────────
const canvasLabel = computed(() => {
	const d = commandQueue.value?.data;
	if (!d)
		return t('画布空');
	const sel = props.selectedBuildingIndex === null ? undefined : d.buildings[props.selectedBuildingIndex];
	const parts = [t('画布描述', { name: d.header.shortDesc.trim() || t('未命名'), count: d.buildings.length })];
	if (sel)
		parts.push(t('画布选中', { name: buildingLabel(sel.index) }));
	return parts.join(' ');
});
watchEffect(() => {
	renderer.domElement.setAttribute('aria-label', canvasLabel.value);
});
renderer.domElement.setAttribute('role', 'img');

function buildingLabel(index: number) {
	const bd = commandQueue.value?.data.buildings[index];
	if (!bd)
		return '';
	return bd.recipeId > 0 ? `${itemName(bd.itemId)}：${recipeName(bd.recipeId)}` : itemName(bd.itemId);
}

const tip = reactive({ visible: false, x: 0, y: 0, text: '' });

onMounted(() => {
	const rootEl = root.value!;
	const canvas = renderer.domElement;

	controls = new PlanetMapControls(camera, canvas);
	controls.listenToKeyEvents(rootEl);
	controls.minDistance = R * 1.04;
	controls.maxDistance = R * 4;
	controls.targetRadius = R;
	controls.update();
	rig = new CameraRig(camera, controls, R);
	const onControlStart = () => rig?.stop();
	controls.addEventListener('start', onControlStart);
	onUnmounted(() => {
		controls?.removeEventListener('start', onControlStart);
		controls?.dispose();
	});
	// 渲染器是异步组件：可能在蓝图打开之后才挂载
	if (b.value)
		frameBlueprint();

	const pickAt = (e: { clientX: number, clientY: number }) => {
		if (b.value === null)
			return null;
		const rect = canvas.getBoundingClientRect();
		return pickBuilding(b.value.bvh, camera, R, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
	};

	let downAt: [number, number] | null = null;
	const onPointerDown = (e: PointerEvent) => {
		downAt = e.button === 0 ? [e.clientX, e.clientY] : null;
	};
	const onPointerUp = (e: PointerEvent) => {
		if (e.button !== 0 || downAt === null || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > CLICK_SLOP)
			return;
		downAt = null;
		const picked = pickAt(e);
		multi.value = new Set();
		emit('update:selectedBuildingIndex', picked);
	};

	let pendingMove: PointerEvent | null = null;
	const onPointerMove = (e: PointerEvent) => {
		pendingMove = e;
	};
	const applyHover = () => {
		const e = pendingMove;
		if (e === null)
			return;
		pendingMove = null;
		// 拖动、触摸时不显示悬停
		const picked = e.buttons === 0 && e.pointerType !== 'touch' ? pickAt(e) : null;
		hovered.value = picked;
		canvas.style.cursor = picked === null ? '' : 'pointer';
		if (picked === null) {
			tip.visible = false;
			return;
		}
		const rect = rootEl.getBoundingClientRect();
		tip.x = e.clientX - rect.left;
		tip.y = e.clientY - rect.top;
		tip.text = buildingLabel(picked);
		tip.visible = true;
	};
	const onPointerLeave = () => {
		pendingMove = null;
		hovered.value = null;
		tip.visible = false;
	};
	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerleave', onPointerLeave);
	onUnmounted(() => {
		canvas.removeEventListener('pointerdown', onPointerDown);
		canvas.removeEventListener('pointerup', onPointerUp);
		canvas.removeEventListener('pointermove', onPointerMove);
		canvas.removeEventListener('pointerleave', onPointerLeave);
	});

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || b.value === null)
			return;
		const target = e.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"]'))
			return;
		if (e.key === 'Escape') {
			deselect();
		} else if (e.key === 'f' || e.key === 'F') {
			frameBlueprint();
		} else if (e.key === 't' || e.key === 'T') {
			topView();
		}
	};
	window.addEventListener('keydown', onKeyDown);
	onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

	let mounted = true;
	onUnmounted(() => { mounted = false; });
	let lastTimeStamp: number | null = null;
	function animate(time: number) {
		if (!mounted)
			return;
		requestAnimationFrame(animate);
		const dt = lastTimeStamp === null ? 0 : Math.min((time - lastTimeStamp) / 1000, 0.1);
		lastTimeStamp = time;
		controls!.updateTimeDelta(dt);

		const built = b.value;
		if (built) {
			if (frameOnBuild)
				frameOnBuild = !frameBlueprint();
			applyVisibility(built);
			for (const { layer } of built.layers)
				layer.update(dt);
		}
		applyHover();
		selection.update(dt, reducedMotion.value);

		const { changed, pose } = rig!.update(dt);
		// 天光朝注视点的法线，太阳从相机一侧（东南）斜照，朝向相机的面才亮
		hemiLight.position.copy(pose.normal);
		sunTarget.position.copy(pose.target);
		sun.position.copy(pose.target)
			.addScaledVector(pose.normal, 100).addScaledVector(pose.east, 45).addScaledVector(pose.north, -60);
		renderer.render(scene, camera);
		if (changed)
			cameraPosVersion.value++;
	}
	requestAnimationFrame(animate);
});

onUnmounted(() => selection.dispose());

const selectBoxes = computed(() => b.value?.bvh.boxes);
const cameraPosVersion = ref(0);
const getModel = (index: number) => {
	const built = b.value;
	if (built === null)
		return null;
	for (const { layer } of built.layers) {
		const m = layer.modelOf?.(index);
		if (m)
			return m;
	}
	return null;
}
defineExpose({
	selectBoxes,
	camera,
	cameraPosVersion,
	getModel,
	highlight,
	selectAll,
	frameBlueprint,
});
</script>

<style lang="scss">
.editor-root {
	position: relative;
	width: 100%;
	height: 100%;
	outline: none;

	canvas {
		display: block;
	}
}

.view-tools {
	position: absolute;
	left: 16px;
	bottom: 16px;
	display: flex;
	gap: 6px;
	z-index: 3;
}

.view-tools .tool, .tool-shot {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 34px;
	padding: 0 12px;
	border: 1px solid var(--line);
	border-radius: 8px;
	background: rgba(18, 30, 48, .86);
	backdrop-filter: blur(6px);
	cursor: pointer;
	font-size: 13px;
	color: var(--text);

	&:hover:not(:disabled) {
		border-color: var(--line-2);
		background: rgba(25, 41, 64, .92);
	}
	&[aria-pressed="true"] {
		border-color: var(--holo);
		color: var(--holo);
	}
	&:disabled {
		cursor: default;
		opacity: .55;
	}
	svg {
		width: 16px;
		height: 16px;
		flex: none;
	}
}

.tool-shot {
	position: absolute;
	right: 16px;
	top: 16px;
	z-index: 3;
}

.mode-seg {
	display: inline-flex;
	height: 34px;
	padding: 3px;
	gap: 2px;
	border: 1px solid var(--line);
	border-radius: 8px;
	background: rgba(18, 30, 48, .86);
	backdrop-filter: blur(6px);

	button {
		border: 0;
		border-radius: 6px;
		padding: 0 12px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		font-size: 13px;
		white-space: nowrap;

		&[aria-pressed="true"] {
			background: var(--panel-3);
			color: var(--text);
			box-shadow: inset 0 0 0 1px var(--line-2);
		}
	}
}

.legend {
	position: absolute;
	right: 16px;
	bottom: 16px;
	display: flex;
	gap: 14px;
	padding: 8px 12px;
	border-radius: 8px;
	background: rgba(18, 30, 48, .72);
	font: 12px var(--num);
	color: var(--muted);
	z-index: 3;

	span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	i {
		width: 14px;
		height: 4px;
		border-radius: 2px;
	}
}

.hover-tip {
	position: absolute;
	pointer-events: none;
	padding: 4px 8px;
	border-radius: 6px;
	background: rgba(8, 16, 27, .9);
	border: 1px solid var(--line);
	font-size: 12px;
	color: var(--text);
	white-space: nowrap;
	transform: translate(12px, 12px);
	z-index: 4;
}

// 手机：工具栏只显示图标，避开底部抽屉露出的部分
@media (max-width: 760px) {
	.view-tools {
		left: 10px;
		bottom: calc(var(--sheet-peek) + 10px);
		.label {
			display: none;
		}
		.tool {
			padding: 0 9px;
		}
	}
	.tool-shot {
		right: 10px;
		top: 10px;
		.label {
			display: none;
		}
	}
	.legend {
		right: 10px;
		bottom: calc(var(--sheet-peek) + 56px);
	}
}
</style>

<i18n>
{
    "zh": {
        "视图工具": "视图工具",
        "显示模式": "显示模式",
        "精简": "精简",
        "精简说明": "方盒加配方图标，不下载模型，打开最快",
        "真实模型": "真实模型",
        "真实模型说明": "游戏真实模型",
        "对准蓝图": "对准蓝图",
        "俯视": "俯视",
        "配方标记": "配方标记",
        "配方标记说明": "在建筑上方显示配方标记",
        "流向": "流向",
        "流向说明": "传送带流向动画",
        "流向已停": "系统设置了减少动态效果，流向动画已停止",
        "截图": "截图",
        "截图说明": "把当前视图保存为图片",
        "等级图例": "颜色图例：传送带、分拣器和建筑饰条的等级",
        "画布空": "蓝图三维预览：尚未打开蓝图",
        "画布描述": "蓝图「{name}」的三维预览，共 {count} 个建筑。拖动旋转，滚轮缩放，点击建筑查看详情，F 对准蓝图，T 俯视，Esc 取消选中。",
        "画布选中": "已选中：{name}。",
        "未命名": "未命名"
    },
    "en": {
        "视图工具": "View tools",
        "显示模式": "Display mode",
        "精简": "Simple",
        "精简说明": "Boxes with recipe icons; no model download, fastest to open",
        "真实模型": "Real model",
        "真实模型说明": "The game's real models",
        "对准蓝图": "Frame blueprint",
        "俯视": "Top view",
        "配方标记": "Recipe badges",
        "配方标记说明": "Show recipe badges on buildings",
        "流向": "Flow",
        "流向说明": "Belt flow animation",
        "流向已停": "Flow animation is off because the system asks for reduced motion",
        "截图": "Screenshot",
        "截图说明": "Save the current view as an image",
        "等级图例": "Colour legend: tier of belts, sorters and building trims",
        "画布空": "Blueprint 3D preview: no blueprint open",
        "画布描述": "3D preview of blueprint \"{name}\" with {count} buildings. Drag to rotate, scroll to zoom, click a building for details, F to frame, T for top view, Esc to deselect.",
        "画布选中": "Selected: {name}.",
        "未命名": "Untitled"
    }
}
</i18n>
