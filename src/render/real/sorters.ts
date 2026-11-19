import {
    BufferAttribute, BufferGeometry, Color, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh, Material, Matrix4, Mesh,
    MeshBasicMaterial, Texture, Vector3,
} from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isBelt, isInserter } from '@/data/items';
import { fadedMaterial, GHOST_OPACITY, tintFor, WHITE } from '../core/materials';
import { MergedParts } from '../core/mergedParts';
import { createLinksLayer } from '../simple/links';
import type { Layer, LayerContext } from '../layers';
import {
    connectsToBuilding, cycleSeconds, endFrame, grabberAt, grabberPhase, PARKED_PHASE, SorterShape, sorterShape, stretchVertex,
} from '../sorterPose';
import { patchIconAtlas } from './iconAtlas';
import type { GLTFLike } from './loader';

/** 分拣器的建筑模型编号 → 等级（Mk.I..Mk.IV 集装分拣器），清单 sorters 段的键是 sorter-mk{等级} */
export const SORTER_TIER_OF_MODEL: Readonly<Record<number, 1 | 2 | 3 | 4>> = { 41: 1, 42: 2, 43: 3, 483: 4 };
/** 清单里没有 inserterSpeed / arrowSpeed 时各等级的值（PrefabDesc.inserterSTT、箭头滚动） */
const DEFAULT_STT: Record<number, number> = { 1: 200000, 2: 100000, 3: 50000, 4: 30000 };
const DEFAULT_ARROW_SPEED: Record<number, number> = { 1: 2, 2: 4, 3: 6, 4: 6 };
/** 抓手上物品图标贴花的边长与高度（抓手局部坐标，米） */
const ICON_SIZE = 0.42;
const ICON_LIFT = -0.015;
/** 分拣器之间动画相位的错开量（黄金比例分数），避免所有抓手同步 */
const PHASE_STEP = 0.6180339887;

/** 模型文件所在的清单条目（public/models/manifest.json 的 sorters 段） */
export interface SorterManifestEntry {
    file: string;
    bytes: number;
    arrowSpeed?: number;
}

/** 部件名 → 该部件在每个分拣器上的位置：与端点同位姿的 A/B 端件与护轨、抓手、带货的抓手 */
type PartName = 'ACap' | 'ARail' | 'BCap' | 'BRail' | 'grabber' | 'grabberLoaded';
const PARTS: PartName[] = ['ACap', 'ARail', 'BCap', 'BRail', 'grabber', 'grabberLoaded'];

const ghostOf = (m: Material) => fadedMaterial(m, GHOST_OPACITY);

/** 一种部件的实例化网格对（正常 / 淡化） */
class InstPair {
    readonly main: InstancedMesh;
    readonly ghost: InstancedMesh | null;
    readonly ghostMaterial: Material | null;
    private nMain = 0;
    private nGhost = 0;

    /** tinted：正常那份按实例颜色显示悬停/选中（图标贴花不需要） */
    constructor(name: string, geometry: BufferGeometry, material: Material, capacity: number,
        ghostMaterial: Material | null = ghostOf(material), private readonly tinted = true) {
        this.main = new InstancedMesh(geometry, material, capacity);
        this.main.name = name;
        this.main.frustumCulled = false;
        // 实例颜色在第一次编译前就要存在，否则着色器不带实例颜色
        if (tinted) {
            for (let i = 0; i < capacity; i++)
                this.main.setColorAt(i, WHITE);
        }
        this.main.count = 0;
        this.ghostMaterial = ghostMaterial;
        this.ghost = ghostMaterial ? new InstancedMesh(geometry, ghostMaterial, capacity) : null;
        if (this.ghost) {
            this.ghost.name = `${name}-ghost`;
            this.ghost.frustumCulled = false;
            this.ghost.renderOrder = 1;
            this.ghost.count = 0;
        }
    }

    get drawn() {
        return this.nMain + this.nGhost;
    }

    begin() {
        this.nMain = this.nGhost = 0;
    }

    /** dim 的那份在没有淡化网格（图标贴花）时不画 */
    add(m: Matrix4, dim: boolean, tint: Color | null = null) {
        if (!dim) {
            if (this.tinted)
                this.main.setColorAt(this.nMain, tint ?? WHITE);
            this.main.setMatrixAt(this.nMain++, m);
        } else if (this.ghost)
            this.ghost.setMatrixAt(this.nGhost++, m);
    }

    end() {
        this.main.count = this.nMain;
        this.main.visible = this.nMain > 0;
        this.main.instanceMatrix.needsUpdate = true;
        if (this.main.instanceColor)
            this.main.instanceColor.needsUpdate = true;
        if (this.ghost) {
            this.ghost.count = this.nGhost;
            this.ghost.visible = this.nGhost > 0;
            this.ghost.instanceMatrix.needsUpdate = true;
        }
    }

    dispose() {
        // 几何体与原材质属于共享的 GLB 缓存，只释放自己克隆的材质
        this.main.dispose();
        this.ghost?.dispose();
        this.ghostMaterial?.dispose();
    }
}

/** 抓手顶面的物品图标贴花：每个实例一个图集格下标（与 cargo.ts 的货物板同一套图集） */
function decalGeometry() {
    const h = ICON_SIZE / 2;
    // glTF 坐标，朝 +y；本地 x 右 = −glTF x，所以 u 随 −x 增大，v 随 +z（前向）增大
    const positions = [-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h];
    const uvs = [1, 0, 0, 0, 0, 1, 1, 1];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
}

function decalMaterial(atlas: Texture | null) {
    const m = new MeshBasicMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
    patchIconAtlas(m, {
        atlas,
        fragment: `
	vec4 icon = atlasIcon(vIconUv);
	if (icon.a < 0.05) discard;
	diffuseColor = vec4(icon.rgb, icon.a);`,
        cacheKey: 'sorter-icon-decal',
    });
    return m;
}

interface SorterState {
    building: BlueprintBuilding;
    shape: SorterShape;
    /** 动画相位偏移 [0,1) */
    offset: number;
    /** 抓手带的物品图标（图集下标，0 = 推断不出） */
    icon: number;
}

/** 蓝图里的分拣器按两端坐标系建立姿态（不依赖模型是否到达，占位弧线也用同一份建筑） */
function buildShape(ctx: LayerContext, b: BlueprintBuilding): SorterShape | null {
    const tr = ctx.transforms[b.index];
    if (!tr || tr.length < 2)
        return null;
    const at = (index: number) => ctx.buildings[index];
    // 游戏：A 端 = 输入（取货）一侧，B 端 = 输出（放货）一侧；连到传送带（或没有连接）的一端不画护轨、顶梁不缩进
    const pick = at(b.inputObjIdx);
    const put = at(b.outputObjIdx);
    const t1 = connectsToBuilding(pick ? b.inputObjIdx : -1, b.inputFromSlot, pick ? isBelt(pick.itemId) : false);
    const t2 = connectsToBuilding(put ? b.outputObjIdx : -1, b.outputToSlot, put ? isBelt(put.itemId) : false);
    return sorterShape(
        endFrame(tr[0], b.yaw[0], b.tilt[0], b.pitch[0]),
        endFrame(tr[1], b.yaw[1], b.tilt[1], b.pitch[1]),
        t1, t2,
    );
}

const grabberMatrix = new Matrix4();
const decalMatrix = new Matrix4();
const decalLift = new Matrix4().makeTranslation(0, ICON_LIFT, 0);
const tmp = new Vector3();
const pos = new Vector3();

/** 一个等级的分拣器真实模型：端件/护轨/抓手实例化，顶梁与箭头按各自两端拉伸后合并成一个网格 */
class TierModel {
    readonly group = new Group();
    private readonly pairs = new Map<PartName, InstPair>();
    private readonly decals: InstPair;
    private readonly decalIcons: InstancedBufferAttribute;
    private readonly decalGeometry: BufferGeometry;
    private readonly merged: MergedParts[] = [];
    private readonly materials: Material[] = [];
    private readonly arrowMap: Texture | null;
    /** 箭头沿 v 每秒前进的贴图重复数 */
    private readonly arrowSpeed: number;
    private readonly cycle: number;
    private time = 0;
    private dirty = true;
    private mask: Uint8Array | null = null;
    /** false（关闭流向或减少动态效果）时时间不再前进，抓手停在 PARKED_PHASE */
    private flowing = true;
    private tintOf: (index: number) => Color | null = () => null;

    constructor(readonly modelIndex: number, private readonly sorters: SorterState[], gltf: GLTFLike, atlas: Texture | null, arrowSpeed: number | undefined) {
        const tier = SORTER_TIER_OF_MODEL[modelIndex];
        this.group.name = `sorter-${modelIndex}`;
        this.cycle = cycleSeconds(buildingMeta.get(modelIndex)?.work?.inserterSpeed ?? DEFAULT_STT[tier] ?? DEFAULT_STT[1]);
        gltf.scene.updateMatrixWorld(true);
        const meshOf = (name: string) => {
            const o = gltf.scene.getObjectByName(name) as Mesh | undefined;
            return o && o.isMesh ? o : null;
        };
        for (const name of PARTS) {
            const mesh = meshOf(name);
            if (!mesh)
                continue;
            const pair = new InstPair(name, mesh.geometry, mesh.material as Material, sorters.length);
            this.pairs.set(name, pair);
            this.group.add(pair.main);
            if (pair.ghost)
                this.group.add(pair.ghost);
        }
        const decal = decalMaterial(atlas);
        const decalGeo = decalGeometry();
        this.decals = new InstPair('icon', decalGeo, decal, sorters.length, null, false);
        const iconAttr = new InstancedBufferAttribute(new Float32Array(sorters.length), 1);
        decalGeo.setAttribute('cargoIcon', iconAttr);
        this.decalIcons = iconAttr;
        this.materials.push(decal);
        this.group.add(this.decals.main);
        this.decalGeometry = decalGeo;

        let arrowMap: Texture | null = null;
        let speed = arrowSpeed ?? DEFAULT_ARROW_SPEED[tier] ?? 2;
        for (const name of ['topBeam', 'arrow']) {
            const mesh = meshOf(name);
            if (!mesh)
                continue;
            const material = mesh.material as Material;
            const parts = this.stretchSorters(mesh.geometry, name === 'arrow');
            const dim = ghostOf(material);
            this.materials.push(dim);
            const built = parts.build(material, dim);
            // 模型没带法线时按合并后的几何算，不能拿位置当法线
            if (!mesh.geometry.getAttribute('normal'))
                built.geometry.computeVertexNormals();
            built.frustumCulled = false;
            built.name = name;
            this.group.add(built);
            this.merged.push(parts);
            if (name === 'arrow') {
                arrowMap = (material as MeshBasicMaterial).map ?? null;
                const extra = (material.userData as { arrowSpeed?: number } | undefined)?.arrowSpeed;
                if (typeof extra === 'number')
                    speed = extra;
            }
        }
        this.arrowMap = arrowMap;
        this.arrowSpeed = speed;
        this.write();
    }

    /** 每个分拣器一份顶梁/箭头：_FRAME 0 的顶点跟着 ATop，1 的跟着 BTop；箭头的 v 按两顶点之间的长度平铺 */
    private stretchSorters(geometry: BufferGeometry, arrow: boolean) {
        const P = geometry.getAttribute('position');
        const N = geometry.getAttribute('normal');
        const U = geometry.getAttribute('uv');
        const F = geometry.getAttribute('_frame');
        const index = geometry.getIndex();
        const parts = new MergedParts();
        for (const s of this.sorters) {
            parts.part(s.building.index);
            const base = parts.vertexCount;
            for (let i = 0; i < P.count; i++) {
                const frame = F && F.getX(i) > 0.5 ? 1 : 0;
                stretchVertex(s.shape, frame, tmp.set(P.getX(i), P.getY(i), P.getZ(i)), pos);
                parts.positions.push(pos.x, pos.y, pos.z);
                if (N) {
                    tmp.set(N.getX(i), N.getY(i), N.getZ(i)).transformDirection(s.shape.stretch[frame]);
                    parts.normals.push(tmp.x, tmp.y, tmp.z);
                }
                if (U)
                    parts.uv0.push(U.getX(i), arrow ? (frame === 1 ? s.shape.arrowLength : 0) : U.getY(i));
            }
            const idx = index ? index.array : Array.from({ length: P.count }, (_, i) => i);
            for (let k = 0; k + 2 < idx.length; k += 3)
                parts.tri(base + idx[k], base + idx[k + 1], base + idx[k + 2]);
        }
        return parts;
    }

    /** 当前正在画出的实例数（调试/测试用） */
    drawn(name: PartName) {
        return this.pairs.get(name)?.drawn ?? 0;
    }

    private isDim(s: SorterState) {
        return this.mask !== null && !this.mask[s.building.index];
    }

    /** 重写所有实例矩阵：端件与护轨（随高亮变化）、抓手（随时间变化） */
    private write() {
        this.dirty = false;
        for (const pair of this.pairs.values())
            pair.begin();
        this.decals.begin();
        const icons = this.decalIcons;
        let nIcon = 0;
        for (const s of this.sorters) {
            const dim = this.isDim(s);
            const tint = this.tintOf(s.building.index);
            const { shape } = s;
            this.pairs.get('ACap')?.add(shape.aFrame, dim, tint);
            this.pairs.get('BCap')?.add(shape.bFrame, dim, tint);
            if (shape.aRail)
                this.pairs.get('ARail')?.add(shape.aFrame, dim, tint);
            if (shape.bRail)
                this.pairs.get('BRail')?.add(shape.bFrame, dim, tint);
            const loaded = grabberAt(shape, this.phaseOf(s), grabberMatrix);
            this.pairs.get('grabber')?.add(grabberMatrix, dim, tint);
            if (loaded) {
                this.pairs.get('grabberLoaded')?.add(grabberMatrix, dim, tint);
                if (s.icon && !dim) {
                    icons.setX(nIcon++, s.icon);
                    this.decals.add(decalMatrix.multiplyMatrices(grabberMatrix, decalLift), false);
                }
            }
        }
        for (const pair of this.pairs.values())
            pair.end();
        this.decals.end();
        icons.needsUpdate = true;
    }

    private phaseOf(s: SorterState) {
        return this.flowing ? grabberPhase(this.time, this.cycle, s.offset) : PARKED_PHASE;
    }

    update(dt: number, flow: boolean) {
        if (flow !== this.flowing) {
            this.flowing = flow;
            this.dirty = true;
        }
        if (flow && dt > 0) {
            this.time += dt;
            this.dirty = true;
            if (this.arrowMap)
                this.arrowMap.offset.y = -((this.time * this.arrowSpeed) % 1);
        }
        if (this.dirty)
            this.write();
    }

    setMask(mask: Uint8Array | null) {
        this.mask = mask;
        for (const m of this.merged)
            m.setMask(mask);
        this.write();
    }

    /** 悬停/选中的实例颜色（端件、护轨、抓手；顶梁与箭头是合并网格，不染色） */
    setTint(tintOf: (index: number) => Color | null) {
        this.tintOf = tintOf;
        this.write();
    }

    /** 携带物品变了（编辑后重新推断）：下次写实例时用新的图标 */
    invalidate() {
        this.dirty = true;
    }

    dispose() {
        for (const pair of this.pairs.values())
            pair.dispose();
        this.decals.dispose();
        this.decalGeometry.dispose();
        for (const m of this.merged)
            m.dispose();
        for (const m of this.materials)
            m.dispose();
        this.pairs.clear();
        this.merged.length = 0;
        this.materials.length = 0;
    }
}

interface TypeEntry {
    modelIndex: number;
    sorters: SorterState[];
    /** 模型到达之前的弧线占位（精简模式同样的外观） */
    placeholder: Layer | null;
    placeholderRoot: Group | null;
    model: TierModel | null;
}

/**
 * 真实模型模式的分拣器：每个等级先显示精简模式的弧线占位，模型到达后换成游戏模型——
 * 端件与护轨放在取货端（localOffset[0] 与 yaw/tilt/pitch[0]）和放货端（[1]），只有顶梁和箭头拉伸，
 * 护轨只在连着建筑的一端显示，抓手沿 [A 抬高, ATop, BTop, B 抬高] 往返，A→B 途中显示带的物品、回程是空的。
 */
export class RealSorters {
    readonly root = new Group();
    private readonly types = new Map<number, TypeEntry>();
    private readonly indices = new Set<number>();
    private mask: Uint8Array | null = null;
    private hovered: number | null = null;
    private selected: ReadonlySet<number> = new Set();
    private readonly tintOf = (index: number) => tintFor(index, this.hovered, this.selected);

    /**
     * @param carried 建筑 index → 物品 id（inferCarriedItems 的结果）
     * @param iconOf  物品 id → 图集下标（IconTexture.requestIcon(itemIconId(id))）
     */
    constructor(private readonly ctx: LayerContext, carried: ReadonlyMap<number, number>, private readonly iconOf: (itemId: number) => number) {
        for (const b of ctx.buildings) {
            if (!isInserter(b.itemId))
                continue;
            const shape = buildShape(ctx, b);
            if (!shape)
                continue;
            let t = this.types.get(b.modelIndex);
            if (!t) {
                t = { modelIndex: b.modelIndex, sorters: [], placeholder: null, placeholderRoot: null, model: null };
                this.types.set(b.modelIndex, t);
            }
            const itemId = carried.get(b.index);
            t.sorters.push({ building: b, shape, offset: (b.index * PHASE_STEP) % 1, icon: itemId ? iconOf(itemId) : 0 });
            this.indices.add(b.index);
        }
        for (const t of this.types.values()) {
            const sub = new Group();
            sub.name = `sorter-placeholder-${t.modelIndex}`;
            // 只画这一级的分拣器弧线，不建传送带路径
            const layer = createLinksLayer({ belts: false });
            layer.build({ ...ctx, root: sub, buildings: t.sorters.map(s => s.building) });
            t.placeholder = layer;
            t.placeholderRoot = sub;
            this.root.add(sub);
        }
    }

    /** 蓝图里的分拣器类型（模型编号） */
    typeKeys() {
        return [...this.types.values()].sort((a, b) => b.sorters.length - a.sorters.length).map(t => t.modelIndex);
    }

    has(index: number) {
        return this.indices.has(index);
    }

    attach(modelIndex: number, gltf: GLTFLike, arrowSpeed?: number) {
        const t = this.types.get(modelIndex);
        if (!t || t.model)
            return;
        const model = new TierModel(modelIndex, t.sorters, gltf, this.ctx.iconTexture.texture ?? null, arrowSpeed);
        model.setMask(this.mask);
        model.setTint(this.tintOf);
        model.update(0, this.ctx.view.flow);
        t.model = model;
        this.root.add(model.group);
        if (t.placeholderRoot)
            this.root.remove(t.placeholderRoot);
        t.placeholder?.dispose();
        t.placeholder = t.placeholderRoot = null;
    }

    update(dt: number, flow: boolean) {
        for (const t of this.types.values())
            t.model?.update(dt, flow);
    }

    setHighlight(mask: Uint8Array | null) {
        this.mask = mask;
        for (const t of this.types.values()) {
            t.placeholder?.setHighlight?.(mask);
            t.model?.setMask(mask);
        }
    }

    setHover(index: number | null) {
        this.hovered = index;
        this.retint();
    }

    setSelected(indices: ReadonlySet<number>) {
        this.selected = new Set(indices);
        this.retint();
    }

    private retint() {
        for (const t of this.types.values())
            t.model?.setTint(this.tintOf);
    }

    /** 编辑后重新推断的携带物品：建筑 index → 物品 id */
    setCarried(carried: ReadonlyMap<number, number>) {
        for (const t of this.types.values()) {
            for (const s of t.sorters) {
                const itemId = carried.get(s.building.index);
                s.icon = itemId ? this.iconOf(itemId) : 0;
            }
            t.model?.invalidate();
        }
    }

    /** 某个部件当前画出的实例数（调试/测试用） */
    drawn(modelIndex: number, name: PartName) {
        return this.types.get(modelIndex)?.model?.drawn(name) ?? 0;
    }

    dispose() {
        for (const t of this.types.values()) {
            t.placeholder?.dispose();
            t.model?.dispose();
        }
        this.types.clear();
        this.indices.clear();
    }
}
