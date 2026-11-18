import { BufferGeometry, Camera, Mesh, MeshBasicMaterial, Vector2, Vector3 } from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta, noIconBuildings } from '@/data/building';
import { isBelt } from '@/data/items';
import { itemIconId } from '@/data/icons';
import { IconTexture } from '@/iconTexture';
import { BeltTier, buildBeltPaths } from '../beltPath';
import { inferCarriedItems } from '../carriedItems';
import { buildingIconId } from '../core/badges';
import { tierOf, TIER_COLORS } from '../core/tiers';
import type { Layer, LayerContext } from '../layers';
import { DEFAULT_LOD_DISTANCE, isModelBuilding, RealBuildings } from './buildings';
import { BadgeItem, FloatingBadges } from './badges';
import { RealBelts } from './belts';
import { beltMetersPerSecond, CargoLane, RealCargo } from './cargo';
import {
    GLTFLike, loadGlb as sharedLoadGlb, loadModelManifest, LoadGlb, LoadProgress, ModelJob, ModelManifest, ModelQueue, progressText,
} from './loader';
import { RealSorters, SORTER_TIER_OF_MODEL, SorterManifestEntry } from './sorters';

export interface RealLayerDeps {
    loadGlb: LoadGlb;
    loadManifest: () => Promise<ModelManifest>;
    /** 同时下载的类型数 */
    concurrency: number;
    /** 进度提示的语言；不给时跟随界面语言 */
    lang?: () => 'zh' | 'en';
}

export interface RealLayer extends Layer {
    readonly progress: LoadProgress;
    /** 重新下载失败的类型（或下载失败的清单） */
    retry(): void;
    /** 这类建筑已显示真实模型 */
    modelShown(modelIndex: number): boolean;
}

/** 相机移动多远后重新按距离分配 LOD */
const LOD_STEP = 0.5;
/** 悬浮标记离模型顶部的高度 */
const BADGE_LIFT = 1.2;
/** 清单里没有 beltSpeed 时各等级的带速参数 */
const BELT_SPEED: Record<BeltTier, number> = { 1: 1, 2: 2, 3: 5 };

/** 清单 belts 段（mk1/mk2/mk3） */
interface BeltManifest {
    belts?: Record<string, { file: string, bytes: number }>;
}

/** 清单 sorters 段（sorter-mk1..mk4，另有 -lod2 变体，这里只用最高细节的一份） */
interface SorterManifest {
    sorters?: Record<string, SorterManifestEntry>;
}

// ───────── 顶部进度提示 ─────────

const PILL_STYLE_ID = 'real-model-pill-style';
const PILL_CSS = `
.model-pill { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 3; display: flex;
  align-items: center; gap: 10px; max-width: calc(100% - 24px); box-sizing: border-box; padding: 7px 8px 7px 14px;
  border-radius: 999px; background: rgba(18, 30, 48, .9); border: 1px solid var(--line, #2A3F5C);
  color: var(--text, #DCE8F5); font-size: 12.5px; backdrop-filter: blur(6px); }
.model-pill[hidden] { display: none; }
.model-pill i { flex: none; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--panel-3, #22354F);
  border-top-color: var(--holo, #7FD8FF); animation: model-pill-spin .8s linear infinite; }
.model-pill.failed i { display: none; }
.model-pill.failed { border-color: rgba(255, 122, 107, .5); }
.model-pill button { flex: none; height: 24px; padding: 0 10px; border: 1px solid var(--holo, #7FD8FF); border-radius: 999px;
  background: transparent; color: var(--holo, #7FD8FF); font-size: 12px; cursor: pointer; }
.model-pill button[hidden] { display: none; }
@keyframes model-pill-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .model-pill i { animation: none; } }
@media (max-width: 760px) { .model-pill { top: 56px; width: calc(100% - 24px); justify-content: center; font-size: 12px; } }
`;

class ProgressPill {
    readonly el: HTMLDivElement;
    private text: HTMLSpanElement;
    private button: HTMLButtonElement;

    constructor(onRetry: () => void) {
        if (!document.getElementById(PILL_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = PILL_STYLE_ID;
            style.textContent = PILL_CSS;
            document.head.appendChild(style);
        }
        this.el = document.createElement('div');
        this.el.className = 'model-pill';
        this.el.setAttribute('role', 'status');
        this.el.hidden = true;
        this.el.appendChild(document.createElement('i'));
        this.text = document.createElement('span');
        this.button = document.createElement('button');
        this.button.type = 'button';
        this.button.addEventListener('click', onRetry);
        this.el.append(this.text, this.button);
    }

    show(text: string, failed: boolean, retryLabel: string) {
        this.el.hidden = false;
        this.text.textContent = text;
        this.el.classList.toggle('failed', failed);
        this.button.hidden = !failed;
        this.button.textContent = retryLabel;
    }

    hide() {
        this.el.hidden = true;
    }
}

let uiLang: () => 'zh' | 'en' = () => 'zh';
let uiLangRequested = false;
/** 界面语言（vue-i18n 的当前语言）；第一次调用时异步取得 */
function defaultLang() {
    if (!uiLangRequested && typeof navigator !== 'undefined') {
        uiLangRequested = true;
        import('@/i18n').then(m => {
            uiLang = () => String(m.default.global.locale.value).startsWith('zh') ? 'zh' : 'en';
        }, () => { /* 保持默认 */ });
    }
    return uiLang();
}

/**
 * 真实模型图层。build 时什么都不下载；第一次显示（选了真实模型）时才建立方盒占位、
 * 读取模型清单并逐类下载模型，到达的类型立即换掉方盒；隐藏（精简模式）时不再开始新的下载。
 * 传送带按等级下载游戏截面模型（到达前为等级色条带），带上画推断出的货物；分拣器按等级下载游戏模型（到达前为弧线），
 * 从两端坐标系摆放并播放抓取动画（见 sorters.ts）。
 */
export function createRealLayer(overrides: Partial<RealLayerDeps> = {}): RealLayer {
    const deps: RealLayerDeps = { loadGlb: sharedLoadGlb, loadManifest: loadModelManifest, concurrency: 4, ...overrides };
    const lang = deps.lang ?? defaultLang;

    let ctx: LayerContext | null = null;
    let visible = false;
    let disposed = false;
    let buildings: RealBuildings | null = null;
    let sorters: RealSorters | null = null;
    let belts: RealBelts | null = null;
    let cargo: RealCargo | null = null;
    /** 每个等级的传送带在下载队列里用的键（该等级传送带的模型编号） */
    const beltKeys = new Map<number, BeltTier>();
    let badges: FloatingBadges | null = null;
    let queue: ModelQueue | null = null;
    let manifest: 'idle' | 'loading' | 'failed' | 'ok' = 'idle';
    let pill: ProgressPill | null = null;
    let camera: Camera | null = null;
    let probe: Mesh | null = null;
    let mask: Uint8Array | null = null;
    let hovered: number | null = null;
    let selected: ReadonlySet<number> = new Set();
    /** 已换成真实模型、顶面图标被隐藏的建筑，及其当前悬浮标记的图标 */
    const badgeIcon = new Map<BlueprintBuilding, number>();
    const camPos = new Vector3();
    /** 上次分配 LOD 时的相机位置，null 表示需要重新分配 */
    let lodAt: Vector3 | null = null;
    const bufferSize = new Vector2();

    const typeCount = () => (buildings?.typeKeys().length ?? 0) + (belts?.tierKeys().length ?? 0) + (sorters?.typeKeys().length ?? 0);

    const progress = (): LoadProgress => {
        if (queue)
            return queue.progress;
        const total = typeCount();
        return { done: 0, total, failed: manifest === 'failed' ? total : 0, loadedBytes: 0, totalBytes: 0 };
    };

    const updatePill = () => {
        if (!pill)
            return;
        const parent = ctx?.renderer.domElement.parentElement;
        if (parent && pill.el.parentElement !== parent)
            parent.appendChild(pill.el);
        const p = progress();
        const busy = manifest === 'loading' || (queue !== null && !queue.finished);
        if (!visible || p.total === 0 || (!busy && p.failed === 0)) {
            pill.hide();
            return;
        }
        const l = lang();
        pill.show(progressText(p, l), !busy && p.failed > 0, l === 'zh' ? '重试' : 'Retry');
    };

    /** 显示模式下隐藏已换模型的建筑的顶面图标（改用悬浮标记），精简模式下恢复 */
    const syncTopIcons = () => {
        if (!ctx)
            return;
        for (const [b] of badgeIcon) {
            if (ctx.icons.hasIcon(b))
                ctx.icons.updateIconId(b, visible ? 0 : ctx.iconTexture.requestIcon(buildingIconId(b)));
        }
    };

    const attach = (modelIndex: number, low: GLTFLike, high: GLTFLike | null, lodDistance: number) => {
        if (disposed || !ctx || !buildings)
            return;
        const top = buildings.attach(modelIndex, low, high, lodDistance);
        if (top === null)
            return;
        lodAt = null;
        const items: BadgeItem[] = [];
        for (const b of buildings.buildingsOf(modelIndex)) {
            if (noIconBuildings.has(b.itemId))
                continue;
            const iconId = buildingIconId(b);
            badgeIcon.set(b, iconId);
            const pos = new Vector3(0, 0, top + BADGE_LIFT).applyMatrix4(ctx.transforms[b.index][0]);
            const tier = tierOf(b.itemId);
            items.push({ index: b.index, icon: ctx.iconTexture.requestIcon(iconId), pos, ring: tier ? TIER_COLORS[tier] : null });
            if (visible && ctx.icons.hasIcon(b))
                ctx.icons.updateIconId(b, 0);
        }
        badges?.add(items);
        badges?.setDim(mask);
    };

    const jobFor = (m: ModelManifest, modelIndex: number): ModelJob | null => {
        const entry = m.buildings[String(modelIndex)];
        if (!entry)
            return null;
        return {
            key: modelIndex,
            bytes: entry.bytes + (entry.lod0?.bytes ?? 0),
            async load(onBytes) {
                let a = 0, b = 0;
                const [low, high] = await Promise.all([
                    deps.loadGlb(entry.file, n => { a = n; onBytes(a + b); }),
                    entry.lod0 ? deps.loadGlb(entry.lod0.file, n => { b = n; onBytes(a + b); }) : Promise.resolve(null),
                ]);
                attach(modelIndex, low, high, entry.lodDistances?.[0] ?? DEFAULT_LOD_DISTANCE);
            },
        };
    };

    const beltJobFor = (m: ModelManifest & BeltManifest, tier: BeltTier): ModelJob | null => {
        const entry = m.belts?.[`mk${tier}`];
        const key = [...beltKeys].find(([, t]) => t === tier)?.[0];
        if (!entry || key === undefined)
            return null;
        return {
            key,
            bytes: entry.bytes,
            async load(onBytes) {
                const gltf = await deps.loadGlb(entry.file, onBytes);
                if (!disposed)
                    belts?.attach(tier, gltf);
            },
        };
    };

    const sorterJobFor = (m: ModelManifest & SorterManifest, modelIndex: number): ModelJob | null => {
        const tier = SORTER_TIER_OF_MODEL[modelIndex];
        const entry = tier ? m.sorters?.[`sorter-mk${tier}`] : undefined;
        if (!entry)
            return null;
        return {
            key: modelIndex,
            bytes: entry.bytes,
            async load(onBytes) {
                const gltf = await deps.loadGlb(entry.file, onBytes);
                if (!disposed)
                    sorters?.attach(modelIndex, gltf, entry.arrowSpeed);
            },
        };
    };

    const start = () => {
        if (manifest === 'loading' || manifest === 'ok' || !buildings || typeCount() === 0)
            return;
        manifest = 'loading';
        updatePill();
        deps.loadManifest().then(m => {
            if (disposed || !buildings)
                return;
            manifest = 'ok';
            const jobs = [
                ...buildings.typeKeys().map(k => jobFor(m, k)),
                ...(belts?.tierKeys() ?? []).map(t => beltJobFor(m, t)),
                ...(sorters?.typeKeys() ?? []).map(k => sorterJobFor(m, k)),
            ].filter((j): j is ModelJob => j !== null);
            queue = new ModelQueue(jobs, { concurrency: deps.concurrency, onChange: updatePill });
            queue.setActive(visible);
            updatePill();
        }, e => {
            console.warn('model manifest failed to load', e);
            manifest = 'failed';
            updatePill();
        });
    };

    /** 带上的货物：每条路径按所属传送带推断出的物品画图标，按该等级带速移动 */
    const buildCargo = (c: LayerContext, rb: RealBelts, items: ReadonlyMap<number, number>) => {
        const lanes: CargoLane[] = rb.paths.map((p, i) => {
            const icons = new Map<number, number>();
            for (const index of p.buildingIndices) {
                const itemId = items.get(index);
                if (itemId)
                    icons.set(index, c.iconTexture.requestIcon(itemIconId(itemId)));
            }
            const modelIndex = c.buildings[p.buildingIndices[0]]?.modelIndex ?? -1;
            const speed = buildingMeta.get(modelIndex)?.work?.beltSpeed ?? BELT_SPEED[p.tier];
            return { tier: p.tier, rings: rb.rings[i], speed: beltMetersPerSecond(speed), icons };
        });
        cargo = new RealCargo(lanes, c.iconTexture.texture ?? null, new Vector2(IconTexture.WIDTH, IconTexture.HEIGHT));
        c.root.add(cargo.group);
    };

    /** 第一次显示时才建立（精简模式完全不付出代价） */
    const ensureBuilt = () => {
        if (buildings || !ctx)
            return;
        buildings = new RealBuildings(ctx);
        ctx.root.add(buildings.root);
        const paths = buildBeltPaths(ctx.data, buildingMeta, ctx.transforms);
        belts = new RealBelts(ctx, paths);
        ctx.root.add(belts.root);
        for (const b of ctx.buildings) {
            if (isBelt(b.itemId) && ![...beltKeys.values()].includes((b.itemId - 2000) as BeltTier))
                beltKeys.set(b.modelIndex, (b.itemId - 2000) as BeltTier);
        }
        const carried = inferCarriedItems(ctx.data);
        buildCargo(ctx, belts, carried);
        const iconTexture = ctx.iconTexture;
        sorters = new RealSorters(ctx, carried, itemId => iconTexture.requestIcon(itemIconId(itemId)));
        ctx.root.add(sorters.root);
        badges = new FloatingBadges(ctx.iconTexture.texture, ctx.buildings.filter(b => isModelBuilding(b) && !noIconBuildings.has(b.itemId)).length);
        ctx.root.add(badges.mesh);
        // 图层契约里没有相机：借一个不画任何东西的网格在渲染时拿到相机
        probe = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
        probe.frustumCulled = false;
        probe.onBeforeRender = (_r, _s, cam) => { camera = cam; };
        ctx.root.add(probe);
        buildings.setHighlight(mask);
        belts.setHighlight(mask);
        cargo?.setHighlight(mask);
        buildings.setHover(hovered);
        buildings.setSelected(selected);
        sorters.setHighlight(mask);
        if (typeof document !== 'undefined')
            pill = new ProgressPill(() => layer.retry());
    };

    const layer: RealLayer = {
        ready: true,
        get progress() {
            return progress();
        },
        retry() {
            if (manifest === 'failed')
                start();
            else
                queue?.retry();
            updatePill();
        },
        modelShown(modelIndex) {
            const tier = beltKeys.get(modelIndex);
            if (tier !== undefined)
                return belts?.shown(tier) ?? false;
            if (sorters?.shown(modelIndex))
                return true;
            return buildings?.shown(modelIndex) ?? false;
        },
        build(c) {
            ctx = c;
        },
        update(dt) {
            if (!visible || !ctx || !buildings)
                return;
            // view.flow 已合并"流向动画"设置与减少动态效果
            belts?.update(dt, ctx.view.flow);
            cargo?.update(dt, ctx.view.flow);
            sorters?.update(dt, ctx.view.flow);
            // 编辑里改了配方：更新悬浮标记，并重新隐藏被更新回来的顶面图标
            for (const [b, iconId] of badgeIcon) {
                const now = buildingIconId(b);
                if (now === iconId)
                    continue;
                badgeIcon.set(b, now);
                badges?.setIcon(b.index, ctx.iconTexture.requestIcon(now));
                if (ctx.icons.hasIcon(b))
                    ctx.icons.updateIconId(b, 0);
            }
            if (badges)
                badges.mesh.visible = ctx.view.badges;
            if (!camera)
                return;
            // 相机移动超过 LOD_STEP 或有新模型到达时才重新分配 LOD
            camPos.setFromMatrixPosition(camera.matrixWorld);
            if (lodAt === null || lodAt.distanceToSquared(camPos) > LOD_STEP * LOD_STEP) {
                buildings.updateLod(camPos);
                lodAt = (lodAt ?? new Vector3()).copy(camPos);
            }
            if (badges && ctx.view.badges) {
                ctx.renderer.getDrawingBufferSize(bufferSize);
                badges.cull(camera, bufferSize.x, bufferSize.y, ctx.renderer.getPixelRatio());
            }
        },
        dispose() {
            disposed = true;
            queue?.setActive(false);
            pill?.el.remove();
            buildings?.dispose();
            sorters?.dispose();
            belts?.dispose();
            cargo?.dispose();
            badges?.dispose();
            probe?.geometry.dispose();
            (probe?.material as MeshBasicMaterial | undefined)?.dispose();
            buildings = sorters = badges = queue = pill = probe = null;
            belts = null;
            cargo = null;
            beltKeys.clear();
            badgeIcon.clear();
            camera = null;
            ctx = null;
        },
        setVisible(v) {
            visible = v;
            if (!ctx)
                return;
            ctx.root.visible = v;
            if (v) {
                ensureBuilt();
                start();
            }
            queue?.setActive(v);
            syncTopIcons();
            updatePill();
        },
        setHighlight(m) {
            mask = m;
            buildings?.setHighlight(m);
            belts?.setHighlight(m);
            cargo?.setHighlight(m);
            sorters?.setHighlight(m);
            badges?.setDim(m);
        },
        setHover(index) {
            hovered = index;
            buildings?.setHover(index);
        },
        setSelected(indices) {
            selected = new Set(indices);
            buildings?.setSelected(selected);
        },
        modelOf(index) {
            if (ctx && ctx.transforms[index] && (sorters?.has(index) || (belts && isBelt(ctx.buildings[index]?.itemId ?? 0))))
                return ctx.transforms[index][0].clone();
            return null;
        },
    };
    return layer;
}
