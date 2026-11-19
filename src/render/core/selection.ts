import {
    BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry, Group, LineBasicMaterial, LineSegments,
    Matrix4, Mesh, MeshBasicMaterial, RingGeometry, Vector3,
} from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isInserter } from '@/data/items';

const HOLO = 0x7FD8FF;
const PULSE_PERIOD = 0.9;
const PULSE_GROW = 0.35;
const unitEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1)).getAttribute('position');
const grow = new Matrix4().makeScale(1.04, 1.04, 1.04);

/** 选中描边（可多选）与主选中建筑底部的脉动光环 */
export class SelectionMarker {
    readonly group = new Group();
    private outline: LineSegments<BufferGeometry, LineBasicMaterial>;
    private ring: Mesh<RingGeometry, MeshBasicMaterial>;
    private ringBase = new Matrix4();
    private ringScale = 1;
    private phase = 0;

    constructor() {
        this.outline = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.9 }));
        this.outline.frustumCulled = false;
        this.outline.renderOrder = 12;
        this.ring = new Mesh(new RingGeometry(0.5, 0.56, 48), new MeshBasicMaterial({
            color: HOLO, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false,
        }));
        this.ring.matrixAutoUpdate = false;
        this.ring.frustumCulled = false;
        this.ring.renderOrder = 12;
        this.ring.visible = false;
        this.group.add(this.outline, this.ring);
    }

    /**
     * boxes：每个建筑的选中框；indices：要描边的建筑；primary：画光环的建筑（单选时）
     */
    set(boxes: Matrix4[], buildings: BlueprintBuilding[], transforms: Matrix4[][], indices: Iterable<number>, primary: number | null) {
        const list = [...indices].filter(i => boxes[i]);
        const pos = new Float32Array(list.length * unitEdges.count * 3);
        const v = new Vector3();
        const m = new Matrix4();
        list.forEach((index, i) => {
            m.multiplyMatrices(boxes[index], grow);
            for (let k = 0; k < unitEdges.count; k++)
                v.fromBufferAttribute(unitEdges, k).applyMatrix4(m).toArray(pos, (i * unitEdges.count + k) * 3);
        });
        this.outline.geometry.dispose();
        this.outline.geometry = new BufferGeometry();
        this.outline.geometry.setAttribute('position', new BufferAttribute(pos, 3));
        this.outline.visible = list.length > 0;

        const b = primary === null ? undefined : buildings[primary];
        this.ring.visible = b !== undefined && transforms[b.index] !== undefined;
        if (b && this.ring.visible) {
            const meta = buildingMeta.get(b.modelIndex);
            let size = 1.6;
            if (meta && !isInserter(b.itemId)) {
                v.setFromMatrixScale(meta.selectUnitBoxTrans);
                size = Math.max(v.x, v.z) * 1.5;
            }
            this.ringScale = size;
            this.ringBase.copy(transforms[b.index][0]).multiply(m.makeTranslation(0, 0, 0.05));
            this.phase = 0;
            this.applyRing(0);
        }
    }

    clear() {
        this.set([], [], [], [], null);
    }

    private applyRing(t: number) {
        const s = this.ringScale * (1 + t * PULSE_GROW);
        this.ring.matrix.copy(this.ringBase).multiply(new Matrix4().makeScale(s, s, 1));
        this.ring.matrixWorldNeedsUpdate = true;
        this.ring.material.opacity = 0.9 - t * PULSE_GROW * 2.2;
    }

    /** 光环脉动；减少动态效果时停在静止状态 */
    update(dt: number, reducedMotion: boolean) {
        if (!this.ring.visible)
            return;
        if (reducedMotion) {
            if (this.phase !== 0) {
                this.phase = 0;
                this.applyRing(0);
            }
            return;
        }
        this.phase = (this.phase + dt / PULSE_PERIOD) % 1;
        this.applyRing(this.phase);
    }

    dispose() {
        this.outline.geometry.dispose();
        this.outline.material.dispose();
        this.ring.geometry.dispose();
        this.ring.material.dispose();
    }
}
