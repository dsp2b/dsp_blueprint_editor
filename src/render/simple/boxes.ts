import {
    BoxGeometry, BufferAttribute, BufferGeometry, Color, EdgesGeometry, InstancedMesh, LineBasicMaterial,
    LineSegments, Material, Matrix4, MeshStandardMaterial, Vector3,
} from 'three';
import { buildingMeta } from '@/data/building';
import { isBelt, isInserter } from '@/data/items';
import { fadedMaterial, GHOST_OPACITY } from '../core/materials';
import { TIER_COLORS, tierOf } from '../core/tiers';
import type { Layer, LayerContext } from '../layers';

/** 精简模式方盒的配色（与 mockup 一致） */
const BODY_COLOR = new Color(0x51647F);
const EDGE_COLOR = new Color(0x9DB4CF);
const HOVER_TINT = new Color(0x15384F);
const SELECT_TINT = new Color(0x1E5577);
const EDGE_ALPHA = 0.55;
const EDGE_ALPHA_DIM = 0.08;
const TRIM_HEIGHT = 0.22;
const TRIM_PAD = 0.12;

const ZERO = new Matrix4().makeScale(0, 0, 0);

interface Instance {
    /** 建筑 index */
    index: number;
    matrix: Matrix4;
    color: Color;
}

/**
 * 一组实例分成"正常"和"淡化"两个 InstancedMesh：高亮时不匹配的实例移到半透明、
 * 不写深度的那一个里，避免半透明实例挡住后面高亮的建筑。
 */
class DimmableInstances {
    readonly main: InstancedMesh;
    readonly ghost: InstancedMesh;
    private slot = new Map<number, number>();
    private dimmed: Uint8Array | null = null;

    constructor(geometry: BufferGeometry, material: Material, ghostMaterial: Material, readonly instances: Instance[]) {
        this.main = new InstancedMesh(geometry, material, instances.length);
        this.ghost = new InstancedMesh(geometry, ghostMaterial, instances.length);
        // 实例矩阵会被改成零矩阵，缓存的包围球不可靠
        this.main.frustumCulled = this.ghost.frustumCulled = false;
        this.ghost.visible = false;
        this.ghost.renderOrder = 1;
        instances.forEach((inst, i) => {
            this.slot.set(inst.index, i);
            this.main.setMatrixAt(i, inst.matrix);
            this.main.setColorAt(i, inst.color);
            this.ghost.setMatrixAt(i, ZERO);
            this.ghost.setColorAt(i, inst.color);
        });
        this.main.instanceMatrix.needsUpdate = true;
        this.ghost.instanceMatrix.needsUpdate = true;
        if (this.main.instanceColor)
            this.main.instanceColor.needsUpdate = true;
        if (this.ghost.instanceColor)
            this.ghost.instanceColor.needsUpdate = true;
    }

    setMask(mask: Uint8Array | null) {
        this.dimmed = mask;
        this.instances.forEach((inst, i) => {
            const dim = mask !== null && !mask[inst.index];
            this.main.setMatrixAt(i, dim ? ZERO : inst.matrix);
            this.ghost.setMatrixAt(i, dim ? inst.matrix : ZERO);
        });
        this.main.instanceMatrix.needsUpdate = true;
        this.ghost.instanceMatrix.needsUpdate = true;
        this.ghost.visible = mask !== null;
    }

    setColor(index: number, color: Color) {
        const i = this.slot.get(index);
        if (i === undefined)
            return;
        this.main.setColorAt(i, color);
        this.main.instanceColor!.needsUpdate = true;
    }

    has(index: number) {
        return this.slot.has(index);
    }

    dispose() {
        this.main.dispose();
        this.ghost.dispose();
    }
}

const ghostOf = (m: MeshStandardMaterial) => fadedMaterial(m, GHOST_OPACITY);

/** 选中框（selectUnitBoxTrans）底部的一圈等级色饰条 */
function trimMatrix(buildingTrans: Matrix4, selectUnitBoxTrans: Matrix4, out: Matrix4) {
    const s = new Vector3().setFromMatrixScale(selectUnitBoxTrans);
    const [w, h, d] = [s.x, s.y, s.z];
    const th = Math.min(TRIM_HEIGHT, h * 0.5);
    out.multiplyMatrices(buildingTrans, selectUnitBoxTrans);
    out.multiply(new Matrix4().makeTranslation(0, -0.5 + th / h / 2, 0));
    out.multiply(new Matrix4().makeScale((w * 0.9 + TRIM_PAD) / w, th / h, (d * 0.9 + TRIM_PAD) / d));
    return out;
}

/** 精简模式：按游戏选中框大小的带光照方盒、描边、等级饰条 */
export function createBoxesLayer(): Layer {
    let ctx: LayerContext | null = null;
    let body: DimmableInstances | null = null;
    let trim: DimmableInstances | null = null;
    let edges: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
    /** 建筑 index → 描边顶点的起始位置 */
    const edgeStart = new Map<number, number>();
    const models = new Map<number, Matrix4>();
    let hovered: number | null = null;
    let selected: ReadonlySet<number> = new Set();
    const tmp = new Color();

    const tintOf = (index: number) => {
        if (selected.has(index))
            return SELECT_TINT;
        if (index === hovered)
            return HOVER_TINT;
        return null;
    };
    const refreshColor = (index: number) => {
        if (!body?.has(index))
            return;
        const tint = tintOf(index);
        body.setColor(index, tint ? tmp.copy(BODY_COLOR).add(tint) : BODY_COLOR);
    };

    return {
        build(c) {
            ctx = c;
            const boxes = c.buildings.filter(b => !isBelt(b.itemId) && !isInserter(b.itemId) && buildingMeta.has(b.modelIndex));
            if (boxes.length === 0)
                return;

            const bodyInst: Instance[] = [];
            const trimInst: Instance[] = [];
            for (const b of boxes) {
                const meta = buildingMeta.get(b.modelIndex)!;
                const t = c.transforms[b.index][0];
                const m = new Matrix4().multiplyMatrices(t, meta.unitBoxTrans);
                models.set(b.index, m);
                bodyInst.push({ index: b.index, matrix: m, color: BODY_COLOR });
                const tier = tierOf(b.itemId);
                if (tier !== null)
                    trimInst.push({ index: b.index, matrix: trimMatrix(t, meta.selectUnitBoxTrans, new Matrix4()), color: TIER_COLORS[tier] });
            }

            const boxGeometry = new BoxGeometry(1, 1, 1);
            // 面往后推一点，描边线才不会和面打架
            const bodyMat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
            body = new DimmableInstances(boxGeometry, bodyMat, ghostOf(bodyMat), bodyInst);
            c.root.add(body.main, body.ghost);

            if (trimInst.length) {
                const trimMat = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
                trim = new DimmableInstances(boxGeometry, trimMat, ghostOf(trimMat), trimInst);
                c.root.add(trim.main, trim.ghost);
            }

            const unitEdges = new EdgesGeometry(boxGeometry).getAttribute('position');
            const n = unitEdges.count;
            const pos = new Float32Array(bodyInst.length * n * 3);
            const col = new Float32Array(bodyInst.length * n * 4);
            const v = new Vector3();
            bodyInst.forEach((inst, i) => {
                edgeStart.set(inst.index, i * n);
                for (let k = 0; k < n; k++) {
                    v.fromBufferAttribute(unitEdges, k).applyMatrix4(inst.matrix);
                    v.toArray(pos, (i * n + k) * 3);
                    EDGE_COLOR.toArray(col, (i * n + k) * 4);
                    col[(i * n + k) * 4 + 3] = EDGE_ALPHA;
                }
            });
            const edgeGeometry = new BufferGeometry();
            edgeGeometry.setAttribute('position', new BufferAttribute(pos, 3));
            edgeGeometry.setAttribute('color', new BufferAttribute(col, 4));
            edges = new LineSegments(edgeGeometry, new LineBasicMaterial({ vertexColors: true, transparent: true }));
            edges.frustumCulled = false;
            c.root.add(edges);
        },
        update() {
            // 方盒没有动画
        },
        dispose() {
            body?.dispose();
            trim?.dispose();
            body?.main.geometry.dispose();
            (body?.main.material as Material | undefined)?.dispose();
            (body?.ghost.material as Material | undefined)?.dispose();
            (trim?.main.material as Material | undefined)?.dispose();
            (trim?.ghost.material as Material | undefined)?.dispose();
            edges?.geometry.dispose();
            edges?.material.dispose();
            body = trim = null;
            edges = null;
            ctx = null;
        },
        setVisible(visible) {
            if (ctx)
                ctx.root.visible = visible;
        },
        setHighlight(mask) {
            body?.setMask(mask);
            trim?.setMask(mask);
            if (edges) {
                const col = edges.geometry.getAttribute('color') as BufferAttribute;
                const n = col.count / Math.max(edgeStart.size, 1);
                for (const [index, start] of edgeStart) {
                    const a = mask !== null && !mask[index] ? EDGE_ALPHA_DIM : EDGE_ALPHA;
                    for (let k = 0; k < n; k++)
                        col.setW(start + k, a);
                }
                col.needsUpdate = true;
            }
        },
        setHover(index) {
            const prev = hovered;
            hovered = index;
            if (prev !== null)
                refreshColor(prev);
            if (index !== null)
                refreshColor(index);
        },
        setSelected(indices) {
            const prev = selected;
            selected = new Set(indices);
            for (const i of prev)
                refreshColor(i);
            for (const i of selected)
                refreshColor(i);
        },
        modelOf(index) {
            const m = models.get(index);
            return m ? m.clone() : null;
        },
    };
}
