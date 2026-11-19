import { Matrix4, PerspectiveCamera, Ray, Sphere, Vector3 } from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isInserter } from '@/data/items';
import { BVH } from '@/bvh';

const pos1 = new Vector3();
const pos2 = new Vector3();
const dir = new Vector3();
export const inserterHeight = 0.3;

/** 分拣器：从起点抬高 inserterHeight 看向终点的变换，返回两端距离 */
export function inserterTrans(transforms: Matrix4[], trans: Matrix4) {
    pos1.setFromMatrixPosition(transforms[0]);
    dir.copy(pos1).normalize().multiplyScalar(inserterHeight);
    pos1.add(dir);

    pos2.setFromMatrixPosition(transforms[1]);
    dir.copy(pos2).normalize().multiplyScalar(inserterHeight);
    pos2.add(dir);

    trans.setPosition(pos1.x, pos1.y, pos1.z);
    trans.lookAt(pos1, pos2, pos1);
    return dir.subVectors(pos1, pos2).length();
}

/** 每个建筑的选中框（单位立方体 → 世界），用于拾取与选中描边 */
export function buildBVH(transforms: Matrix4[][], buildings: BlueprintBuilding[]) {
    const temp = new Matrix4();
    const inserterOffset = new Matrix4().makeTranslation(0, 0, -0.5);

    const selectBoxes = buildings.map((b, i) => {
        const meta = buildingMeta.get(b.modelIndex);
        const box = new Matrix4();
        if (isInserter(b.itemId)) {
            const len = inserterTrans(transforms[i], box);
            box.multiply(temp.makeScale(0.5, 0.5, len));
            box.multiply(inserterOffset);
        } else if (meta) {
            box.multiplyMatrices(transforms[i][0], meta.selectUnitBoxTrans);
        } else {
            box.copy(transforms[i][0]);
        }
        return box;
    });
    return new BVH(selectBoxes);
}

const ray = new Ray();
const planetSphere = new Sphere();
const v = new Vector3();

/** 屏幕坐标（相对画布的 0..1）下最近的建筑；被星球挡住或没点中返回 null */
export function pickBuilding(bvh: BVH, camera: PerspectiveCamera, R: number, x: number, y: number) {
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(x * 2 - 1, -y * 2 + 1, 0.5).unproject(camera).sub(ray.origin).normalize();
    const intersects = bvh.raycast(ray);
    if (intersects.length === 0)
        return null;
    planetSphere.radius = R;
    const hit = ray.intersectSphere(planetSphere, v);
    if (hit !== null && hit.distanceToSquared(ray.origin) < intersects[0].distanceSquared)
        return null;
    return intersects[0].index;
}
