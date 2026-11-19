import {
    BufferAttribute, BufferGeometry, Color, Group, InstancedBufferAttribute, InstancedMesh, Material, Matrix4,
    MeshLambertMaterial, Quaternion, SRGBColorSpace, Texture, Vector3,
} from 'three';
import { BeltTier } from '../beltPath';
import { DIM_OPACITY, fadedMaterial } from '../core/materials';
import { patchIconAtlas } from './iconAtlas';
import type { Ring } from './belts';

/** 游戏每 tick 前进 beltSpeed 个路径点，60 tick/s、点距 0.06 m：1 档速度 = 3.6 m/s */
export const METERS_PER_SECOND_PER_SPEED = 60 * 0.06;
/** 货物间距（米），只为示意，不代表实际流量（满带是 0.6 m） */
export const CARGO_SPACING = 1.2;
/** 货物板（游戏 cargoMesh 的尺寸：0.5 × 0.3 × 0.5，中心在带面上） */
const PLATE_HALF = 0.25;
const PLATE_HALF_HEIGHT = 0.15;
const PLATE_BEVEL = 0.06;
const TOP_COLOR = new Color().setRGB(0.80, 0.85, 0.90, SRGBColorSpace);
const SIDE_COLOR = new Color().setRGB(0.32, 0.38, 0.46, SRGBColorSpace);

/** 带速（m/s）：建筑参数 beltSpeed（1 / 2 / 5）× 3.6 */
export function beltMetersPerSecond(beltSpeed: number) {
    return beltSpeed * METERS_PER_SECOND_PER_SPEED;
}

/** 长 length 的路径上，相位 phase（米）时各货物的弧长位置：phase + k × spacing，落在 [0, length] 内 */
export function cargoOffsets(length: number, spacing: number, phase: number): number[] {
    const out: number[] = [];
    if (!(length > 0) || !(spacing > 0))
        return out;
    for (let s = ((phase % spacing) + spacing) % spacing; s <= length; s += spacing)
        out.push(s);
    return out;
}

/** 在一串圈（弧长递增）上按弧长 s 插值位姿，返回所在区间起点的下标 */
export function sampleRings(rings: readonly Ring[], s: number, pos: Vector3, rot: Quaternion): number {
    let lo = 0, hi = rings.length - 1;
    if (hi <= 0 || s <= rings[0].t) {
        pos.copy(rings[0].pos);
        rot.copy(rings[0].rot);
        return 0;
    }
    if (s >= rings[hi].t) {
        pos.copy(rings[hi].pos);
        rot.copy(rings[hi].rot);
        return hi;
    }
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (rings[mid].t <= s)
            lo = mid;
        else
            hi = mid;
    }
    const a = rings[lo], b = rings[hi];
    const k = b.t > a.t ? (s - a.t) / (b.t - a.t) : 0;
    pos.lerpVectors(a.pos, b.pos, k);
    rot.slerpQuaternions(a.rot, b.rot, k);
    return lo;
}

/**
 * 倒角方块（18 个三角形：顶面 + 4 个倒角 + 4 个侧面，没有底面），局部 x 右、y 前、z 上，
 * 中心在原点。uv 只在顶面有效（0..1，图标朝 +y 即流向），倒角与侧面为 −1。
 */
export function cargoPlateGeometry() {
    const h = PLATE_HALF, i = PLATE_HALF - PLATE_BEVEL;
    const zTop = PLATE_HALF_HEIGHT, zMid = PLATE_HALF_HEIGHT - PLATE_BEVEL, zBot = -PLATE_HALF_HEIGHT;
    const positions: number[] = [];
    const uvs: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], uv: number[] | null) => {
        // a b c d 逆时针（从外侧看）
        for (const p of [a, b, c, a, c, d])
            positions.push(p[0], p[1], p[2]);
        const u = uv ?? [-1, -1, -1, -1, -1, -1, -1, -1];
        for (const k of [0, 1, 2, 0, 2, 3])
            uvs.push(u[k * 2], u[k * 2 + 1]);
    };
    quad([-i, -i, zTop], [i, -i, zTop], [i, i, zTop], [-i, i, zTop], [0, 0, 1, 0, 1, 1, 0, 1]);
    // 四个方向：倒角（顶面边 → 侧面顶边）与侧面
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
        const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
        quad([ax * h, ay * h, zMid], [bx * h, by * h, zMid], [bx * i, by * i, zTop], [ax * i, ay * i, zTop], null);
        quad([ax * h, ay * h, zBot], [bx * h, by * h, zBot], [bx * h, by * h, zMid], [ax * h, ay * h, zMid], null);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    g.computeVertexNormals();
    return g;
}

/** 顶面画图集里的物品图标（cargoIcon 为 IconTexture.requestIcon 的下标），其余面为深色 */
function cargoMaterial(atlas: Texture | null, dim: boolean) {
    const m = dim ? fadedMaterial(new MeshLambertMaterial({ color: 0xffffff }), DIM_OPACITY) : new MeshLambertMaterial({ color: 0xffffff });
    patchIconAtlas(m, {
        atlas,
        uniforms: { uTop: TOP_COLOR, uSide: SIDE_COLOR },
        declarations: 'uniform vec3 uTop;\nuniform vec3 uSide;',
        fragment: `
	if (vIconUv.x < 0.0) {
		diffuseColor.rgb = uSide;
	} else {
		vec2 q = (vIconUv - 0.5) * 1.12 + 0.5;
		vec4 icon = (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) ? atlasIcon(q) : vec4(0.0);
		diffuseColor.rgb = mix(uTop, icon.rgb, icon.a);
	}`,
        cacheKey: `belt-cargo-${dim ? 1 : 0}`,
    });
    return m;
}

export interface CargoLane {
    tier: BeltTier;
    rings: Ring[];
    /** m/s */
    speed: number;
    /** 每圈所属建筑运送的物品图标下标（0 = 推断不出，不画） */
    icons: Map<number, number>;
}

interface LaneState extends CargoLane {
    length: number;
    phase: number;
}

const pos = new Vector3();
const rot = new Quaternion();
const ONE = new Vector3(1, 1, 1);
const mat = new Matrix4();

/**
 * 传送带上的货物：沿每条路径等距排列的实例化货物板，顶面是推断出的物品图标，按带速移动；
 * flow 为 false（关闭流向或减少动态效果）时停在原处。推断不出物品的路段不画。
 */
export class RealCargo {
    readonly group = new Group();
    private readonly lanes: LaneState[];
    private readonly meshes: { mesh: InstancedMesh, icon: InstancedBufferAttribute }[] = [];
    private readonly materials: Material[] = [];
    private mask: Uint8Array | null = null;
    private dirty = true;

    constructor(lanes: CargoLane[], atlas: Texture | null) {
        this.group.name = 'belt-cargo';
        this.lanes = lanes.filter(l => l.rings.length > 1 && l.icons.size > 0)
            .map(l => ({ ...l, length: l.rings[l.rings.length - 1].t, phase: 0 }));
        const capacity = this.lanes.reduce((n, l) => n + Math.floor(l.length / CARGO_SPACING) + 1, 0);
        if (capacity === 0)
            return;
        const base = cargoPlateGeometry();
        for (const dim of [false, true]) {
            const geometry = base.clone();
            const icon = new InstancedBufferAttribute(new Float32Array(capacity), 1);
            geometry.setAttribute('cargoIcon', icon);
            const material = cargoMaterial(atlas, dim);
            const mesh = new InstancedMesh(geometry, material, capacity);
            mesh.frustumCulled = false;
            mesh.name = dim ? 'cargo-ghost' : 'cargo';
            mesh.renderOrder = dim ? 1 : 0;
            mesh.count = 0;
            this.materials.push(material);
            this.meshes.push({ mesh, icon });
            this.group.add(mesh);
        }
        base.dispose();
    }

    /** 已画出的货物数（正常 + 淡化） */
    get drawn() {
        return this.meshes.reduce((n, m) => n + m.mesh.count, 0);
    }

    update(dt: number, flow: boolean) {
        if (!this.meshes.length)
            return;
        if (flow && dt > 0) {
            for (const l of this.lanes)
                l.phase = (l.phase + l.speed * dt) % CARGO_SPACING;
            this.dirty = true;
        }
        if (!this.dirty)
            return;
        this.dirty = false;
        const counts = [0, 0];
        for (const l of this.lanes) {
            for (const s of cargoOffsets(l.length, CARGO_SPACING, l.phase)) {
                const ring = l.rings[sampleRings(l.rings, s, pos, rot)];
                const icon = l.icons.get(ring.building) ?? 0;
                if (!icon)
                    continue;
                const k = this.mask !== null && !this.mask[ring.building] ? 1 : 0;
                const { mesh, icon: attr } = this.meshes[k];
                mesh.setMatrixAt(counts[k], mat.compose(pos, rot, ONE));
                attr.setX(counts[k], icon);
                counts[k]++;
            }
        }
        this.meshes.forEach(({ mesh, icon }, k) => {
            mesh.count = counts[k];
            mesh.visible = counts[k] > 0;
            mesh.instanceMatrix.needsUpdate = true;
            icon.needsUpdate = true;
        });
    }

    setHighlight(mask: Uint8Array | null) {
        this.mask = mask;
        this.dirty = true;
    }

    dispose() {
        for (const { mesh } of this.meshes) {
            mesh.geometry.dispose();
            mesh.dispose();
        }
        for (const m of this.materials)
            m.dispose();
        this.meshes.length = 0;
        this.materials.length = 0;
    }
}
