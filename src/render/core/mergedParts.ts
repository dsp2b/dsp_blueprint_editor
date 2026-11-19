import { BufferAttribute, BufferGeometry, Material, Mesh } from 'three';

interface Part {
    /** 这一段涉及的建筑 index：任一被高亮则整段正常显示 */
    buildings: readonly number[];
    start: number;
    count: number;
}

/**
 * 按建筑分段的合并几何，多段合并成一个网格，靠 geometry group 分成"正常 / 淡化"两种材质：
 * 高亮时把不匹配的段的三角形排到索引末尾，交给半透明、不写深度的材质。
 * 精简模式的条带/弧线与真实模型的传送带扫掠、分拣器顶梁共用。
 */
export class MergedParts {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly uv0: number[] = [];
    readonly uv1: number[] = [];
    readonly indices: number[] = [];
    readonly parts: Part[] = [];
    private full: Uint32Array | null = null;
    mesh: Mesh<BufferGeometry, Material[]> | null = null;

    get vertexCount() {
        return this.positions.length / 3;
    }

    /**
     * 接下来的三角形属于 buildings。单个建筑且与上一段同一建筑、紧接着时并入上一段；
     * 给数组时总是新开一段。
     */
    part(buildings: number | readonly number[]) {
        if (typeof buildings === 'number') {
            const last = this.parts[this.parts.length - 1];
            if (last && last.buildings.length === 1 && last.buildings[0] === buildings && last.start + last.count === this.indices.length)
                return;
            buildings = [buildings];
        }
        this.parts.push({ buildings, start: this.indices.length, count: 0 });
    }

    tri(a: number, b: number, c: number) {
        this.indices.push(a, b, c);
        this.parts[this.parts.length - 1].count += 3;
    }

    build(material: Material, dim: Material) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
        if (this.normals.length)
            geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
        if (this.uv0.length)
            geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv0), 2));
        if (this.uv1.length)
            geometry.setAttribute('uv1', new BufferAttribute(new Float32Array(this.uv1), 2));
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
            for (const lit of [true, false]) {
                const from = k;
                for (const p of this.parts) {
                    if (p.buildings.some(b => mask[b]) !== lit)
                        continue;
                    arr.set(this.full.subarray(p.start, p.start + p.count), k);
                    k += p.count;
                }
                if (k > from)
                    geometry.addGroup(from, k - from, lit ? 0 : 1);
            }
        }
        index.needsUpdate = true;
    }

    dispose() {
        this.mesh?.geometry.dispose();
        this.mesh = null;
    }
}
