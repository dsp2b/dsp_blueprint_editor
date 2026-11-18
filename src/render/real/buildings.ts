import { Box3, BufferGeometry, Color, Group, InstancedMesh, Material, Matrix4, Mesh, Vector3 } from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isBelt, isInserter } from '@/data/items';
import { createBoxesLayer } from '../simple/boxes';
import type { Layer, LayerContext } from '../layers';
import type { GLTFLike } from './loader';

/**
 * glTF 模型空间 → 建筑本地空间：本地 (x, y, z) = glTF (−x, z, y)
 * （等价于 rotation.set(π/2, 0, π, 'ZYX')）。建筑本地 z 朝上、y 朝正前方，
 * 与 unitBoxTrans 对游戏模型空间的映射一致，因此不会镜像。
 */
export const GLTF_TO_LOCAL = new Matrix4().set(
    -1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

/** 清单没给 LOD 距离时，相机距离小于它的实例用 LOD0 */
export const DEFAULT_LOD_DISTANCE = 120;
const GHOST_OPACITY = 0.14;
const WHITE = new Color(1, 1, 1);
/** 实例颜色与材质颜色相乘：悬停、选中时偏全息青并提亮 */
const HOVER_TINT = new Color(1.3, 1.55, 1.75);
const SELECT_TINT = new Color(1.45, 1.85, 2.3);

/** 模型都画的建筑（传送带、分拣器另行处理） */
export function isModelBuilding(b: BlueprintBuilding) {
    return !isBelt(b.itemId) && !isInserter(b.itemId) && buildingMeta.has(b.modelIndex);
}

function ghostOf(m: Material) {
    const g = m.clone();
    g.transparent = true;
    g.opacity = GHOST_OPACITY;
    g.depthWrite = false;
    return g;
}

interface Part {
    /** 0 为 LOD0，1 为最低一级 */
    lod: 0 | 1;
    main: InstancedMesh;
    ghost: InstancedMesh;
    ghostMaterial: Material | Material[];
    /** 每个实例这个部件的世界矩阵 */
    matrices: Matrix4[];
}

/** 一类建筑的实例化模型：每个 LOD 的每个网格各一对（正常 / 淡化）InstancedMesh */
class TypeModel {
    readonly group = new Group();
    readonly parts: Part[] = [];
    /** 每个实例当前用的 LOD（0 近 / 1 远），只有存在 LOD0 时才切换 */
    readonly lodOf: Uint8Array;
    readonly hasLod0: boolean;
    /** 模型最高点在建筑本地 z 上的高度（放悬浮标记用） */
    readonly top: number;
    private readonly positions: Vector3[];

    constructor(modelIndex: number, readonly indices: number[], worlds: Matrix4[], low: GLTFLike, high: GLTFLike | null, private lodDistance: number) {
        this.group.name = `model-${modelIndex}`;
        this.hasLod0 = high !== null;
        this.lodOf = new Uint8Array(indices.length).fill(1);
        this.positions = worlds.map(w => new Vector3().setFromMatrixPosition(w));
        const box = new Box3();
        this.addParts(low, 1, worlds, box);
        if (high)
            this.addParts(high, 0, worlds, null);
        this.top = box.isEmpty() ? 1 : box.max.z;
    }

    private addParts(gltf: GLTFLike, lod: 0 | 1, worlds: Matrix4[], bounds: Box3 | null) {
        gltf.scene.updateMatrixWorld(true);
        const meshes: Mesh[] = [];
        gltf.scene.traverse(o => {
            if ((o as Mesh).isMesh)
                meshes.push(o as Mesh);
        });
        for (const mesh of meshes) {
            const geometry = mesh.geometry as BufferGeometry;
            const local = new Matrix4().multiplyMatrices(GLTF_TO_LOCAL, mesh.matrixWorld);
            if (bounds) {
                geometry.computeBoundingBox();
                if (geometry.boundingBox)
                    bounds.union(geometry.boundingBox.clone().applyMatrix4(local));
            }
            const material = mesh.material;
            const ghostMaterial = Array.isArray(material) ? material.map(ghostOf) : ghostOf(material);
            const n = worlds.length;
            const main = new InstancedMesh(geometry, material, n);
            const ghost = new InstancedMesh(geometry, ghostMaterial, n);
            // 实例数随 LOD/高亮变化，缓存的包围球不可靠
            main.frustumCulled = ghost.frustumCulled = false;
            main.name = `lod${lod}`;
            ghost.name = `lod${lod}-ghost`;
            ghost.renderOrder = 1;
            for (let i = 0; i < n; i++)
                main.setColorAt(i, WHITE);
            this.parts.push({
                lod, main, ghost, ghostMaterial,
                matrices: worlds.map(w => new Matrix4().multiplyMatrices(w, local)),
            });
            this.group.add(main, ghost);
        }
    }

    /** 按相机位置重新分配 LOD，有实例换了 LOD 时返回 true */
    updateLod(camera: Vector3) {
        if (!this.hasLod0)
            return false;
        let changed = false;
        const d2 = this.lodDistance * this.lodDistance;
        this.positions.forEach((p, i) => {
            const lod = p.distanceToSquared(camera) < d2 ? 0 : 1;
            if (this.lodOf[i] !== lod) {
                this.lodOf[i] = lod;
                changed = true;
            }
        });
        return changed;
    }

    /** 把每个实例紧凑地写进它所在 LOD、高亮状态对应的 InstancedMesh */
    write(mask: Uint8Array | null, tintOf: (index: number) => Color | null) {
        for (const part of this.parts) {
            let nMain = 0, nGhost = 0;
            this.indices.forEach((index, i) => {
                const lod = this.hasLod0 ? this.lodOf[i] : 1;
                if (lod !== part.lod)
                    return;
                if (mask !== null && !mask[index]) {
                    part.ghost.setMatrixAt(nGhost++, part.matrices[i]);
                } else {
                    part.main.setMatrixAt(nMain, part.matrices[i]);
                    part.main.setColorAt(nMain++, tintOf(index) ?? WHITE);
                }
            });
            part.main.count = nMain;
            part.ghost.count = nGhost;
            part.main.visible = nMain > 0;
            part.ghost.visible = nGhost > 0;
            part.main.instanceMatrix.needsUpdate = true;
            part.ghost.instanceMatrix.needsUpdate = true;
            if (part.main.instanceColor)
                part.main.instanceColor.needsUpdate = true;
        }
    }

    /** 各 LOD 实际画出的实例数（调试/测试用） */
    drawn(lod: 0 | 1) {
        const part = this.parts.find(p => p.lod === lod);
        return part ? part.main.count + part.ghost.count : 0;
    }

    dispose() {
        // 几何体与原材质属于共享的 GLB 缓存，这里只释放自己克隆的淡化材质
        for (const part of this.parts) {
            const ghosts = Array.isArray(part.ghostMaterial) ? part.ghostMaterial : [part.ghostMaterial];
            ghosts.forEach(m => m.dispose());
            part.main.dispose();
            part.ghost.dispose();
        }
    }
}

interface TypeEntry {
    modelIndex: number;
    buildings: BlueprintBuilding[];
    /** 模型到达之前的方盒占位（与精简模式同样的外观） */
    placeholder: Layer | null;
    placeholderRoot: Group | null;
    model: TypeModel | null;
}

/**
 * 真实模型模式的建筑：每类建筑先显示方盒占位，模型到达后换成实例化模型。
 * 高亮、悬停、选中状态保存在这里，占位与模型都按它显示。
 */
export class RealBuildings {
    readonly root = new Group();
    private readonly types = new Map<number, TypeEntry>();
    private mask: Uint8Array | null = null;
    private hovered: number | null = null;
    private selected: ReadonlySet<number> = new Set();
    private readonly typeOf = new Map<number, TypeEntry>();

    constructor(private readonly ctx: LayerContext) {
        for (const b of ctx.buildings) {
            if (!isModelBuilding(b))
                continue;
            let t = this.types.get(b.modelIndex);
            if (!t) {
                t = { modelIndex: b.modelIndex, buildings: [], placeholder: null, placeholderRoot: null, model: null };
                this.types.set(b.modelIndex, t);
            }
            t.buildings.push(b);
            this.typeOf.set(b.index, t);
        }
        for (const t of this.types.values()) {
            const sub = new Group();
            sub.name = `placeholder-${t.modelIndex}`;
            const layer = createBoxesLayer();
            layer.build({ ...ctx, root: sub, buildings: t.buildings });
            t.placeholder = layer;
            t.placeholderRoot = sub;
            this.root.add(sub);
        }
    }

    /** 蓝图里的建筑类型（模型编号），实例多的在前 */
    typeKeys() {
        return [...this.types.values()].sort((a, b) => b.buildings.length - a.buildings.length).map(t => t.modelIndex);
    }

    buildingsOf(modelIndex: number): readonly BlueprintBuilding[] {
        return this.types.get(modelIndex)?.buildings ?? [];
    }

    shown(modelIndex: number) {
        return this.types.get(modelIndex)?.model != null;
    }

    /** 某类模型下载完成：换掉它的方盒占位。返回模型最高点高度（建筑本地 z） */
    attach(modelIndex: number, low: GLTFLike, high: GLTFLike | null, lodDistance: number) {
        const t = this.types.get(modelIndex);
        if (!t || t.model)
            return null;
        const worlds = t.buildings.map(b => this.ctx.transforms[b.index][0]);
        const model = new TypeModel(modelIndex, t.buildings.map(b => b.index), worlds, low, high, lodDistance);
        t.model = model;
        this.root.add(model.group);
        this.writeType(t);
        if (t.placeholderRoot)
            this.root.remove(t.placeholderRoot);
        t.placeholder?.dispose();
        t.placeholder = t.placeholderRoot = null;
        return model.top;
    }

    private tintOf = (index: number) => {
        if (this.selected.has(index))
            return SELECT_TINT;
        if (index === this.hovered)
            return HOVER_TINT;
        return null;
    };

    private writeType(t: TypeEntry) {
        t.model?.write(this.mask, this.tintOf);
    }

    updateLod(camera: Vector3) {
        for (const t of this.types.values()) {
            if (t.model?.updateLod(camera))
                this.writeType(t);
        }
    }

    /** 各 LOD 画出的实例总数（调试/测试用） */
    drawn(lod: 0 | 1) {
        let n = 0;
        for (const t of this.types.values())
            n += t.model?.drawn(lod) ?? 0;
        return n;
    }

    setHighlight(mask: Uint8Array | null) {
        this.mask = mask;
        for (const t of this.types.values()) {
            t.placeholder?.setHighlight?.(mask);
            this.writeType(t);
        }
    }

    setHover(index: number | null) {
        const prev = this.hovered;
        this.hovered = index;
        for (const t of this.types.values())
            t.placeholder?.setHover?.(index);
        const touched = new Set([prev, index].map(i => i === null ? undefined : this.typeOf.get(i)));
        for (const t of touched) {
            if (t)
                this.writeType(t);
        }
    }

    setSelected(indices: ReadonlySet<number>) {
        const touched = new Set<TypeEntry | undefined>();
        for (const i of this.selected)
            touched.add(this.typeOf.get(i));
        this.selected = new Set(indices);
        for (const i of this.selected)
            touched.add(this.typeOf.get(i));
        for (const t of this.types.values())
            t.placeholder?.setSelected?.(this.selected);
        for (const t of touched) {
            if (t)
                this.writeType(t);
        }
    }

    dispose() {
        for (const t of this.types.values()) {
            t.placeholder?.dispose();
            t.model?.dispose();
        }
        this.types.clear();
        this.typeOf.clear();
    }
}
