import {
    BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DoubleSide, Material, Matrix4, Mesh,
    MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TubeGeometry, Vector3,
} from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isInserter } from '@/data/items';
import { BeltPath, BeltTier, buildBeltPaths } from '../beltPath';
import { TIER_COLORS, tierOf } from '../core/tiers';
import type { Layer, LayerContext } from '../layers';

const FALLBACK = new Color(0xdddddd);
const DIM_OPACITY = 0.3;
/** 传送带条带半宽（米） */
const BELT_HALF_WIDTH = 0.3;
/** 一个箭头沿带长占的长度（米） */
const ARROW_LENGTH = 1.0;
/** 箭头滚动速度（米/秒，与 mockup 一致） */
const FLOW_SPEED: Record<BeltTier, number> = { 1: 0.6, 2: 1.2, 3: 1.8 };
/** 分拣器弧线：两端离地高度、拱高上限、管半径 */
const SORTER_BASE = 0.3;
const SORTER_ARCH = 1.1;
const SORTER_RADIUS = 0.08;
const SORTER_SEGMENTS = 16;

/** 深色底上的等级色箭头（指向 +u，即流向） */
function chevronTexture(color: Color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const g = canvas.getContext('2d')!;
    g.fillStyle = `#${color.clone().multiplyScalar(0.55).getHexString()}`;
    g.fillRect(0, 0, 64, 32);
    g.strokeStyle = `#${color.getHexString()}`;
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(22, 6);
    g.lineTo(38, 16);
    g.lineTo(22, 26);
    g.stroke();
    const t = new CanvasTexture(canvas);
    t.wrapS = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

interface Part {
    /** 这一段涉及的建筑 index：任一被高亮则整段正常显示 */
    buildings: number[];
    start: number;
    count: number;
}

/**
 * 多段几何合并成一个网格，靠 geometry group 分成"正常 / 淡化"两种材质：
 * 高亮时把不匹配的段的三角形排到索引末尾，交给半透明、不写深度的材质。
 */
class MergedParts {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly uvs: number[] = [];
    readonly indices: number[] = [];
    readonly parts: Part[] = [];
    private full: Uint32Array | null = null;
    mesh: Mesh<BufferGeometry, Material[]> | null = null;

    begin(buildings: number[]) {
        this.parts.push({ buildings, start: this.indices.length, count: 0 });
        return this.positions.length / 3;
    }

    end() {
        const p = this.parts[this.parts.length - 1];
        p.count = this.indices.length - p.start;
    }

    build(material: Material, dim: Material) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
        if (this.normals.length)
            geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
        if (this.uvs.length)
            geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
        this.full = new Uint32Array(this.indices);
        geometry.setIndex(new BufferAttribute(this.full.slice(), 1));
        geometry.addGroup(0, this.full.length, 0);
        geometry.computeBoundingSphere();
        this.mesh = new Mesh(geometry, [material, dim]);
        return this.mesh;
    }

    setMask(mask: Uint8Array | null) {
        if (!this.mesh || !this.full)
            return;
        const geometry = this.mesh.geometry;
        const index = geometry.getIndex()!;
        const arr = index.array as Uint32Array;
        geometry.clearGroups();
        if (mask === null) {
            arr.set(this.full);
            geometry.addGroup(0, arr.length, 0);
        } else {
            let k = 0;
            const lit = (p: Part) => p.buildings.some(b => mask[b]);
            for (const pass of [true, false]) {
                const from = k;
                for (const p of this.parts)
                    if (lit(p) === pass) {
                        arr.set(this.full.subarray(p.start, p.start + p.count), k);
                        k += p.count;
                    }
                if (k > from)
                    geometry.addGroup(from, k - from, pass ? 0 : 1);
            }
        }
        index.needsUpdate = true;
    }

    dispose() {
        this.mesh?.geometry.dispose();
        this.mesh = null;
    }
}

function dimOf<M extends Material>(m: M) {
    const d = m.clone() as M;
    d.transparent = true;
    d.opacity = DIM_OPACITY;
    d.depthWrite = false;
    return d;
}

const side = new Vector3();
/** 沿路径的等级色条带；u 为弧长/箭头长度，v 跨宽度 */
function addStrip(parts: MergedParts, path: BeltPath) {
    if (path.points.length < 2)
        return;
    const base = parts.begin(path.buildingIndices);
    for (const p of path.points) {
        side.set(1, 0, 0).applyQuaternion(p.rot).multiplyScalar(BELT_HALF_WIDTH);
        parts.positions.push(p.pos.x + side.x, p.pos.y + side.y, p.pos.z + side.z);
        parts.positions.push(p.pos.x - side.x, p.pos.y - side.y, p.pos.z - side.z);
        parts.uvs.push(p.t / ARROW_LENGTH, 0, p.t / ARROW_LENGTH, 1);
    }
    for (let i = 0; i + 1 < path.points.length; i++) {
        const k = base + i * 2;
        parts.indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    parts.end();
}

const p0 = new Vector3();
const p1 = new Vector3();
const up = new Vector3();
/** 分拣器：从取货端拱到放货端的弧形管 */
function addArc(parts: MergedParts, b: BlueprintBuilding, transforms: Matrix4[]) {
    p0.setFromMatrixPosition(transforms[0]);
    p1.setFromMatrixPosition(transforms[1]);
    const len = p0.distanceTo(p1);
    if (len < 0.05)
        return;
    up.addVectors(p0, p1).normalize();
    const arch = Math.min(SORTER_ARCH, 0.4 + 0.35 * len);
    const pts: Vector3[] = [];
    for (let i = 0; i <= SORTER_SEGMENTS; i++) {
        const k = i / SORTER_SEGMENTS;
        pts.push(new Vector3().lerpVectors(p0, p1, k).addScaledVector(up, SORTER_BASE + Math.sin(Math.PI * k) * arch));
    }
    const tube = new TubeGeometry(new CatmullRomCurve3(pts), SORTER_SEGMENTS, SORTER_RADIUS, 6);
    const base = parts.begin([b.index]);
    parts.positions.push(...(tube.getAttribute('position').array as Float32Array));
    parts.normals.push(...(tube.getAttribute('normal').array as Float32Array));
    for (const i of Array.from(tube.getIndex()!.array))
        parts.indices.push(base + i);
    parts.end();
    tube.dispose();
}

/** 精简模式：传送带为带流向箭头的等级色条带（按游戏 Bezier 路径），分拣器为等级色弧线 */
export function createLinksLayer(): Layer {
    let ctx: LayerContext | null = null;
    const groups: MergedParts[] = [];
    const materials: Material[] = [];
    const flows: { texture: CanvasTexture, speed: number }[] = [];
    const indices = new Set<number>();

    return {
        build(c) {
            ctx = c;
            const paths = buildBeltPaths(c.data, buildingMeta, c.transforms);
            const byTier = new Map<BeltTier, BeltPath[]>();
            for (const p of paths) {
                byTier.set(p.tier, [...byTier.get(p.tier) ?? [], p]);
                p.buildingIndices.forEach(i => indices.add(i));
            }
            for (const [tier, list] of byTier) {
                const parts = new MergedParts();
                list.forEach(p => addStrip(parts, p));
                if (!parts.indices.length)
                    continue;
                const texture = chevronTexture(TIER_COLORS[tier]);
                const material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
                const dim = dimOf(material);
                materials.push(material, dim);
                flows.push({ texture, speed: FLOW_SPEED[tier] });
                c.root.add(parts.build(material, dim));
                groups.push(parts);
            }

            const sorters = new Map<number, MergedParts>();
            for (const b of c.buildings) {
                if (!isInserter(b.itemId) || !c.transforms[b.index])
                    continue;
                const tier = tierOf(b.itemId);
                const color = tier ? TIER_COLORS[tier] : buildingMeta.get(b.modelIndex)?.color ?? FALLBACK;
                const key = color.getHex();
                const parts = sorters.get(key) ?? new MergedParts();
                sorters.set(key, parts);
                addArc(parts, b, c.transforms[b.index]);
                indices.add(b.index);
            }
            for (const [hex, parts] of sorters) {
                if (!parts.indices.length)
                    continue;
                const color = new Color(hex);
                const material = new MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 });
                const dim = dimOf(material);
                materials.push(material, dim);
                c.root.add(parts.build(material, dim));
                groups.push(parts);
            }
        },
        update(dt) {
            // 关闭流向或要求减少动态效果时（view.flow 已合并两者）箭头停在原处
            if (!ctx?.view.flow)
                return;
            for (const f of flows)
                f.texture.offset.x = (f.texture.offset.x - f.speed * dt / ARROW_LENGTH) % 1;
        },
        dispose() {
            for (const g of groups)
                g.dispose();
            for (const m of materials)
                m.dispose();
            for (const f of flows)
                f.texture.dispose();
            groups.length = 0;
            materials.length = 0;
            flows.length = 0;
            indices.clear();
            ctx = null;
        },
        setVisible(visible) {
            if (ctx)
                ctx.root.visible = visible;
        },
        setHighlight(mask) {
            for (const g of groups)
                g.setMask(mask);
        },
        modelOf(index) {
            if (!ctx || !indices.has(index))
                return null;
            return ctx.transforms[index][0].clone();
        },
    };
}
