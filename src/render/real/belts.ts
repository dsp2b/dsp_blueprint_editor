import {
    BufferGeometry, DoubleSide, Group, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial,
    MeshStandardMaterial, Quaternion, Vector3,
} from 'three';
import { BeltPath, BeltTier, BELT_LIFT } from '../beltPath';
import { DIM_OPACITY, fadedMaterial, GLTF_TO_LOCAL } from '../core/materials';
import { MergedParts } from '../core/mergedParts';
import { TIER_COLORS } from '../core/tiers';
import type { LayerContext } from '../layers';
import type { GLTFLike } from './loader';

/** 贴图沿带长一次重复的长度（米）：u = 弧长 / 1.02 */
export const METERS_PER_TEX_REPEAT = 1.02;
/** 中间轨道滚动：每秒贴图重复数 = uvSpeed × 3.529412（材质 extras 缺失时用） */
const REPEATS_PER_UV_SPEED = 3.529412;
/** 只有 |v − 0.5| 小于它的中间轨道滚动，两侧边缘不动 */
const SCROLL_LANE = 0.34;
const UV_SPEED: Record<BeltTier, number> = { 1: 1, 2: 2, 3: 5 };
/** 模型到达前的占位条带半宽 */
const PLACEHOLDER_HALF_WIDTH = 0.4;

// ───────── 截面扫掠（纯函数） ─────────

/** 1 m 直段 z=0 一圈的顶点（glTF 坐标：x 横向、y 向上） */
export interface SectionVert {
    x: number;
    y: number;
    nx: number;
    ny: number;
    /** TEXCOORD_0.y（贴图横向） */
    v0: number;
    /** TEXCOORD_1.y（边缘灯横向） */
    v1: number;
}

export interface BeltSection {
    verts: SectionVert[];
    /** 每个三角形三个顶点；值 < verts.length 为前一圈，否则为后一圈的 (值 − verts.length) */
    tris: number[];
}

/** 从 GLB 的 segment（沿 +z 的 1 m 直段）取出截面：z≈0 一圈顶点，z≈1 的顶点按位置与法线对应回去 */
export function sectionOf(geometry: BufferGeometry): BeltSection {
    const P = geometry.getAttribute('position');
    const N = geometry.getAttribute('normal');
    const U0 = geometry.getAttribute('uv');
    const U1 = geometry.getAttribute('uv1') ?? U0;
    const ring0: number[] = [];
    const ring1: number[] = [];
    for (let i = 0; i < P.count; i++)
        (P.getZ(i) < 0.5 ? ring0 : ring1).push(i);
    const slot = new Map<number, number>();
    ring0.forEach((v, k) => slot.set(v, k));
    const same = (a: number, b: number) => Math.abs(P.getX(a) - P.getX(b)) < 1e-4 && Math.abs(P.getY(a) - P.getY(b)) < 1e-4
        && Math.abs(N.getX(a) - N.getX(b)) < 1e-3 && Math.abs(N.getY(a) - N.getY(b)) < 1e-3;
    for (const v of ring1) {
        const k = ring0.findIndex(u => same(u, v));
        if (k < 0)
            throw new Error('belt segment: end ring does not match the start ring');
        slot.set(v, ring0.length + k);
    }
    const verts = ring0.map(i => ({ x: P.getX(i), y: P.getY(i), nx: N.getX(i), ny: N.getY(i), v0: U0.getY(i), v1: U1.getY(i) }));
    const index = geometry.getIndex();
    const tris: number[] = [];
    const count = index ? index.count : P.count;
    for (let k = 0; k < count; k++)
        tris.push(slot.get(index ? index.getX(k) : k)!);
    return { verts, tris };
}

/** 扫掠用的一圈：位姿取自路径点，e 为边缘灯坐标（TEXCOORD_1.x，每节传送带 0→1，灯在 0.5） */
export interface Ring {
    pos: Vector3;
    rot: Quaternion;
    /** 弧长（米），贴图 u = t / 1.02 */
    t: number;
    e: number;
    /** 这一圈所属的传送带建筑 index */
    building: number;
    /** 不与上一圈相连（两节传送带交界处重复的一圈） */
    cut: boolean;
}

/** 每个路径点属于哪一节传送带（path.buildingIndices 的下标）：沿流向取离得最近的节点 */
export function pointOwners(path: BeltPath, nodes: readonly Vector3[]): number[] {
    const owners: number[] = [];
    let k = 0;
    for (const p of path.points) {
        while (k + 1 < nodes.length && p.pos.distanceToSquared(nodes[k + 1]) < p.pos.distanceToSquared(nodes[k]))
            k++;
        owners.push(k);
    }
    return owners;
}

/**
 * 路径点 → 扫掠的圈。游戏按每节传送带自己的 z（0→1）取边缘灯贴图，所以每节一对灯：
 * 这里让 e 在节点处为 0.5、在与前后节的交界处为 0 / 1；悬空端只剩半节时按另一半的长度算。
 * 交界处的点重复一次（前一节 e=1，后一节 e=0），避免插值扫过灯的位置。
 * nodes：path.buildingIndices 对应节点的世界坐标（已抬高 BELT_LIFT）。
 */
export function beltRings(path: BeltPath, nodes: readonly Vector3[]): Ring[] {
    const pts = path.points;
    if (pts.length === 0)
        return [];
    const owners = pointOwners(path, nodes);
    const n = path.buildingIndices.length;
    const start = new Array<number>(n).fill(NaN);
    const end = new Array<number>(n).fill(NaN);
    const pivot = new Array<number>(n).fill(NaN);
    const best = new Array<number>(n).fill(Infinity);
    owners.forEach((k, i) => {
        if (Number.isNaN(start[k]))
            start[k] = pts[i].t;
        end[k] = i + 1 < pts.length && owners[i + 1] !== k ? pts[i + 1].t : pts[i].t;
        const d = pts[i].pos.distanceToSquared(nodes[k]);
        if (d < best[k]) {
            best[k] = d;
            pivot[k] = pts[i].t;
        }
    });
    const eOf = (k: number, t: number) => {
        let before = pivot[k] - start[k];
        let after = end[k] - pivot[k];
        if (before < 1e-6)
            before = after;
        if (after < 1e-6)
            after = before;
        if (before < 1e-6)
            return 0.5;
        const e = t < pivot[k] ? 0.5 - 0.5 * (pivot[k] - t) / before : 0.5 + 0.5 * (t - pivot[k]) / after;
        return Math.min(1, Math.max(0, e));
    };
    const rings: Ring[] = [];
    pts.forEach((p, i) => {
        const k = owners[i];
        if (i > 0 && owners[i - 1] !== k) {
            const j = owners[i - 1];
            rings.push({ pos: p.pos, rot: p.rot, t: p.t, e: eOf(j, p.t), building: path.buildingIndices[j], cut: false });
            rings.push({ pos: p.pos, rot: p.rot, t: p.t, e: eOf(k, p.t), building: path.buildingIndices[k], cut: true });
        } else {
            rings.push({ pos: p.pos, rot: p.rot, t: p.t, e: eOf(k, p.t), building: path.buildingIndices[k], cut: i === 0 });
        }
    });
    return rings;
}

const right = new Vector3();
const up = new Vector3();
const nrm = new Vector3();

/**
 * 沿一串圈扫掠截面，写进 out。截面坐标按 GLTF_TO_LOCAL 换到路径点的局部坐标
 * （glTF x → −右，y → 上，z → 前），这个换算行列式为 +1，所以三角形绕序不变。
 */
export function sweep(rings: readonly Ring[], section: BeltSection, out: MergedParts) {
    const R = section.verts.length;
    let prevBase = -1;
    for (const ring of rings) {
        const base = out.vertexCount;
        right.set(1, 0, 0).applyQuaternion(ring.rot);
        up.set(0, 0, 1).applyQuaternion(ring.rot);
        const u = ring.t / METERS_PER_TEX_REPEAT;
        for (const v of section.verts) {
            out.positions.push(
                ring.pos.x - right.x * v.x + up.x * v.y,
                ring.pos.y - right.y * v.x + up.y * v.y,
                ring.pos.z - right.z * v.x + up.z * v.y,
            );
            nrm.copy(right).multiplyScalar(-v.nx).addScaledVector(up, v.ny).normalize();
            out.normals.push(nrm.x, nrm.y, nrm.z);
            out.uv0.push(u, v.v0);
            out.uv1.push(ring.e, v.v1);
        }
        if (prevBase >= 0 && !ring.cut) {
            out.part(ring.building);
            const tris = section.tris;
            const at = (s: number) => s < R ? prevBase + s : base + s - R;
            for (let k = 0; k + 2 < tris.length; k += 3)
                out.tri(at(tris[k]), at(tris[k + 1]), at(tris[k + 2]));
        }
        prevBase = base;
    }
}

/** 节点（传送带建筑根节点）抬高到带面后的位置 */
export function beltNodes(path: BeltPath, transforms: readonly Matrix4[][]) {
    return path.buildingIndices.map(i => {
        const p = new Vector3().setFromMatrixPosition(transforms[i][0]);
        return p.addScaledVector(p.clone().normalize(), BELT_LIFT);
    });
}

// ───────── 端头（纯函数） ─────────

export type CapKind = 'head-short' | 'head-long';

export interface CapPlacement {
    building: number;
    tier: BeltTier;
    kind: CapKind;
    /** 端头网格（glTF 坐标）→ 世界 */
    matrix: Matrix4;
}

const FLIP = new Matrix4().makeRotationZ(Math.PI);

/**
 * 路径端头放端头模型（CargoTraffic.AlterPathRenderer）：起点转 180°，终点照路径朝向；
 * 整条带只有一节（游戏 pathLength ≤ 10）时用短端头，否则用长端头。
 */
export function capPlacements(path: BeltPath): CapPlacement[] {
    const pts = path.points;
    if (pts.length === 0)
        return [];
    const kind: CapKind = path.startCap && path.endCap && path.buildingIndices.length <= 1 ? 'head-short' : 'head-long';
    const at = (i: number, flip: boolean) => {
        const m = new Matrix4().compose(pts[i].pos, pts[i].rot, new Vector3(1, 1, 1));
        if (flip)
            m.multiply(FLIP);
        return m.multiply(GLTF_TO_LOCAL);
    };
    const caps: CapPlacement[] = [];
    if (path.startCap)
        caps.push({ building: path.buildingIndices[0], tier: path.tier, kind, matrix: at(0, true) });
    if (path.endCap)
        caps.push({ building: path.buildingIndices[path.buildingIndices.length - 1], tier: path.tier, kind, matrix: at(pts.length - 1, false) });
    return caps;
}

// ───────── 中间轨道滚动的材质 ─────────

interface ScrollUniform {
    uScroll: { value: number };
}

/** map_fragment 改成：中间轨道 u_sample = u − fract(速率 × 时间)，两侧不动 */
function patchScroll(material: Material, uniforms: ScrollUniform) {
    material.onBeforeCompile = shader => {
        shader.uniforms.uScroll = uniforms.uScroll;
        shader.fragmentShader = 'uniform float uScroll;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
	vec2 beltUv = vMapUv;
	if (abs(beltUv.y - 0.5) < ${SCROLL_LANE.toFixed(2)})
		beltUv.x -= uScroll;
	diffuseColor *= texture2D(map, beltUv);
#endif`);
    };
    material.customProgramCacheKey = () => 'belt-scroll';
}

const dimOf = <M extends Material>(m: M) => fadedMaterial(m, DIM_OPACITY);

/** GLB 里名为 name 的节点（或其下第一个网格） */
function findMesh(gltf: GLTFLike, name: string): Mesh | null {
    let found: Mesh | null = null;
    gltf.scene.getObjectByName(name)?.traverse(o => {
        if (!found && (o as Mesh).isMesh)
            found = o as Mesh;
    });
    return found;
}

// ───────── 一个等级的传送带 ─────────

interface CapMeshes {
    main: InstancedMesh;
    ghost: InstancedMesh;
    ghostMaterial: Material;
    caps: CapPlacement[];
}

class TierBelts {
    readonly group = new Group();
    private parts: MergedParts | null = null;
    private readonly materials: Material[] = [];
    private readonly caps: CapMeshes[] = [];
    private readonly uniforms: ScrollUniform = { uScroll: { value: 0 } };
    /** 中间轨道每秒滚过的贴图重复数 */
    private rate = 0;
    private phase = 0;
    real = false;

    constructor(readonly tier: BeltTier, private readonly paths: BeltPath[], private readonly rings: Ring[][]) {
        this.group.name = `belts-mk${tier}`;
        this.buildPlaceholder();
    }

    /** 模型到达前：等级色的平条带 */
    private buildPlaceholder() {
        const parts = new MergedParts();
        const side = new Vector3();
        const normal = new Vector3();
        for (const rings of this.rings) {
            let prev = -1;
            for (const r of rings) {
                const base = parts.vertexCount;
                side.set(PLACEHOLDER_HALF_WIDTH, 0, 0).applyQuaternion(r.rot);
                normal.set(0, 0, 1).applyQuaternion(r.rot);
                parts.positions.push(r.pos.x + side.x, r.pos.y + side.y, r.pos.z + side.z, r.pos.x - side.x, r.pos.y - side.y, r.pos.z - side.z);
                parts.normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
                if (prev >= 0 && !r.cut) {
                    parts.part(r.building);
                    parts.tri(prev, prev + 1, base);
                    parts.tri(prev + 1, base + 1, base);
                }
                prev = base;
            }
        }
        if (!parts.indices.length)
            return;
        const material = new MeshBasicMaterial({ color: TIER_COLORS[this.tier], side: DoubleSide });
        const dim = dimOf(material);
        this.materials.push(material, dim);
        this.group.add(parts.build(material, dim));
        this.parts = parts;
    }

    /** 换成游戏截面扫掠 + 端头 */
    attach(gltf: GLTFLike, mask: Uint8Array | null) {
        if (this.real)
            return;
        const segment = findMesh(gltf, 'segment');
        if (!segment)
            throw new Error(`belt mk${this.tier}: no segment mesh`);
        const section = sectionOf(segment.geometry as BufferGeometry);
        const parts = new MergedParts();
        for (const rings of this.rings)
            sweep(rings, section, parts);

        const source = segment.material as MeshStandardMaterial;
        const extras = source.userData ?? {};
        this.rate = typeof extras.scrollTexRepeatsPerSecond === 'number'
            ? extras.scrollTexRepeatsPerSecond
            : (typeof extras.uvSpeed === 'number' ? extras.uvSpeed : UV_SPEED[this.tier]) * REPEATS_PER_UV_SPEED;
        const material = source.clone();
        const dim = dimOf(source);
        patchScroll(material, this.uniforms);
        patchScroll(dim, this.uniforms);

        this.disposeContent();
        this.real = true;
        this.materials.push(material, dim);
        if (parts.indices.length) {
            this.group.add(parts.build(material, dim));
            this.parts = parts;
        }

        const placements = this.paths.flatMap(capPlacements);
        for (const kind of ['head-short', 'head-long'] as CapKind[]) {
            const caps = placements.filter(c => c.kind === kind);
            const head = caps.length ? findMesh(gltf, kind) : null;
            if (!head)
                continue;
            const headMaterial = head.material as Material;
            const ghostMaterial = dimOf(headMaterial);
            const main = new InstancedMesh(head.geometry, headMaterial, caps.length);
            const ghost = new InstancedMesh(head.geometry, ghostMaterial, caps.length);
            main.frustumCulled = ghost.frustumCulled = false;
            main.name = `${kind}`;
            ghost.name = `${kind}-ghost`;
            ghost.renderOrder = 1;
            this.caps.push({ main, ghost, ghostMaterial, caps });
            this.group.add(main, ghost);
        }
        this.setMask(mask);
    }

    update(dt: number, flow: boolean) {
        if (!flow || !this.real)
            return;
        this.phase = (this.phase + this.rate * dt) % 1;
        this.uniforms.uScroll.value = this.phase;
    }

    setMask(mask: Uint8Array | null) {
        this.parts?.setMask(mask);
        for (const c of this.caps) {
            let nMain = 0, nGhost = 0;
            for (const cap of c.caps) {
                if (mask !== null && !mask[cap.building])
                    c.ghost.setMatrixAt(nGhost++, cap.matrix);
                else
                    c.main.setMatrixAt(nMain++, cap.matrix);
            }
            c.main.count = nMain;
            c.ghost.count = nGhost;
            c.main.visible = nMain > 0;
            c.ghost.visible = nGhost > 0;
            c.main.instanceMatrix.needsUpdate = true;
            c.ghost.instanceMatrix.needsUpdate = true;
        }
    }

    private disposeContent() {
        if (this.parts?.mesh)
            this.group.remove(this.parts.mesh);
        this.parts?.dispose();
        this.parts = null;
        // 克隆出来的材质归自己；贴图、端头几何体与端头原材质属于共享的 GLB 缓存
        for (const m of this.materials)
            m.dispose();
        this.materials.length = 0;
        for (const c of this.caps) {
            this.group.remove(c.main, c.ghost);
            c.ghostMaterial.dispose();
            c.main.dispose();
            c.ghost.dispose();
        }
        this.caps.length = 0;
    }

    dispose() {
        this.disposeContent();
    }
}

/**
 * 真实模型模式的传送带：按等级先画等级色条带占位，等级的 GLB 到达后换成游戏截面沿路径扫掠
 * （中间轨道按等级速度滚动、每节一对边缘灯、悬空端放端头）。
 */
export class RealBelts {
    readonly root = new Group();
    private readonly tiers = new Map<BeltTier, TierBelts>();
    private mask: Uint8Array | null = null;
    /** 每条路径的圈（与 paths 同序），货物沿它们找所属建筑 */
    readonly rings: Ring[][];

    constructor(ctx: Pick<LayerContext, 'transforms'>, readonly paths: BeltPath[]) {
        this.root.name = 'real-belts';
        this.rings = paths.map(p => beltRings(p, beltNodes(p, ctx.transforms)));
        const byTier = new Map<BeltTier, number[]>();
        paths.forEach((p, i) => byTier.set(p.tier, [...byTier.get(p.tier) ?? [], i]));
        for (const [tier, list] of [...byTier].sort((a, b) => a[0] - b[0])) {
            const t = new TierBelts(tier, list.map(i => paths[i]), list.map(i => this.rings[i]));
            this.tiers.set(tier, t);
            this.root.add(t.group);
        }
    }

    /** 蓝图里出现的等级 */
    tierKeys(): BeltTier[] {
        return [...this.tiers.keys()];
    }

    attach(tier: BeltTier, gltf: GLTFLike) {
        this.tiers.get(tier)?.attach(gltf, this.mask);
    }

    update(dt: number, flow: boolean) {
        for (const t of this.tiers.values())
            t.update(dt, flow);
    }

    setHighlight(mask: Uint8Array | null) {
        this.mask = mask;
        for (const t of this.tiers.values())
            t.setMask(mask);
    }

    dispose() {
        for (const t of this.tiers.values())
            t.dispose();
        this.tiers.clear();
    }
}
