import { Matrix4, Vector3 } from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isInserter } from '@/data/items';

/**
 * 相机取景（纯函数，便于测试）。
 *
 * PlanetMapControls 让相机始终看向球心；渲染器在它的结果上再加一个"俯仰角"：
 * 相机绕地表注视点向南倾斜 tilt，仍看向注视点。控制器管理的位置叫 base（在注视点正上方）。
 */

export interface FramingOptions {
    /** 星球半径 */
    R: number;
    /** 垂直视角（度） */
    fov: number;
    /** 宽/高 */
    aspect: number;
    /** 俯仰角（弧度），0 为正俯视 */
    tilt?: number;
    /** 画面边缘留白：包围点最多占半屏的这个比例 */
    margin?: number;
    /** 相机到注视点距离的上下限（来自控制器的 min/maxDistance） */
    minDistance?: number;
    maxDistance?: number;
    /** 倾斜后仍需拉到这么远（蓝图太大）时改用正俯视，避免看到地平线外 */
    flattenBeyond?: number;
}

export interface CameraPose {
    /** 地表上的注视点 */
    target: Vector3;
    /** 注视点处的单位法线、朝北、朝东 */
    normal: Vector3;
    north: Vector3;
    east: Vector3;
    /** 相机位置与上方向 */
    position: Vector3;
    up: Vector3;
    /** 相机到注视点的距离 */
    distance: number;
    tilt: number;
}

export interface Framing extends CameraPose {
    /** 交给 PlanetMapControls 的相机位置（注视点正上方） */
    base: Vector3;
}

const worldNorth = new Vector3(0, 1, 0);

/** 球面上 n 处的东、北方向；纬度增加为北，经度增加为东（与 calcBuildingTrans 一致） */
export function tangentFrame(n: Vector3, east = new Vector3(), north = new Vector3()) {
    east.crossVectors(worldNorth, n);
    if (east.lengthSq() < 1e-10)  // 极点上东向不确定，取 +x
        east.set(1, 0, 0);
    east.normalize();
    north.crossVectors(n, east).normalize();
    return { east, north };
}

/**
 * 由注视点法线、画面朝向（切平面内的单位向量，画面上方）、距离与俯仰角求相机姿态。
 * 返回的 north/east 是画面的"前方/右方"（朝北时就是地理上的北/东）。
 */
export function poseFromView(normal: Vector3, forward: Vector3, R: number, distance: number, tilt: number): CameraPose {
    const n = normal.clone().normalize();
    const north = forward.clone().addScaledVector(n, -forward.dot(n));
    if (north.lengthSq() < 1e-10)
        tangentFrame(n, undefined, north);
    north.normalize();
    const east = new Vector3().crossVectors(north, n);
    const target = n.clone().multiplyScalar(R);
    distance = Math.max(distance, 0);
    const c = Math.cos(tilt), s = Math.sin(tilt);
    // 相机在注视点的后方上方，看向前方
    const dir = n.clone().multiplyScalar(c).addScaledVector(north, -s);
    const up = n.clone().multiplyScalar(s).addScaledVector(north, c);
    const position = target.clone().addScaledVector(dir, distance);
    return { target, normal: n, north, east, position, up, distance, tilt };
}

/** 由 base 位置（注视点正上方，画面朝北）求出带俯仰角的相机姿态 */
export function poseFromBase(base: Vector3, R: number, tilt: number): CameraPose {
    const normal = base.clone().normalize();
    const { north } = tangentFrame(normal);
    return poseFromView(normal, north, R, base.length() - R, tilt);
}

/** forward 相对地理北方的朝向角：0 为朝北，正值为从外面看逆时针（转向西） */
export function headingOf(normal: Vector3, forward: Vector3) {
    const { east, north } = tangentFrame(normal.clone().normalize());
    return Math.atan2(-forward.dot(east), forward.dot(north));
}

/** 朝向角 heading 对应的 forward 向量（headingOf 的逆） */
export function forwardFromHeading(normal: Vector3, heading: number, out = new Vector3()) {
    const { east, north } = tangentFrame(normal.clone().normalize());
    return out.copy(north).multiplyScalar(Math.cos(heading)).addScaledVector(east, -Math.sin(heading));
}

/** 选中框角点（分拣器取两端），用来求蓝图在球面上的包围范围 */
export function blueprintBoundsPoints(buildings: BlueprintBuilding[], transforms: Matrix4[][]) {
    const points: Vector3[] = [];
    const m = new Matrix4();
    for (const b of buildings) {
        const t = transforms[b.index];
        const meta = buildingMeta.get(b.modelIndex);
        if (isInserter(b.itemId) || meta === undefined) {
            for (const part of t)
                points.push(new Vector3().setFromMatrixPosition(part));
            continue;
        }
        m.multiplyMatrices(t[0], meta.selectUnitBoxTrans);
        for (let i = 0; i < 8; i++)
            points.push(new Vector3(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(m));
    }
    return points;
}

function fitDistance(points: Vector3[], pose: CameraPose, tanV: number, tanH: number, near: number) {
    const dir = pose.position.clone().sub(pose.target).normalize();
    if (pose.distance === 0)  // poseFromBase 在距离为 0 时给不出方向，按法线算
        dir.copy(pose.normal);
    const right = new Vector3().crossVectors(pose.up, dir).normalize();
    const q = new Vector3();
    let d = 0;
    for (const p of points) {
        q.subVectors(p, pose.target);
        const z = q.dot(dir);
        d = Math.max(d, z + Math.abs(q.dot(right)) / tanH, z + Math.abs(q.dot(pose.up)) / tanV, z + near);
    }
    return d;
}

/**
 * 求能框住所有包围点的相机：注视点取包围范围在切平面上的中点，
 * 距离取让每个点都落在视锥（留白后）内的最小值，再按控制器限制夹紧。
 */
export function frameBounds(points: Vector3[], opts: FramingOptions): Framing {
    const { R } = opts;
    const margin = opts.margin ?? 0.8;
    const minDistance = opts.minDistance ?? 0;
    const maxDistance = opts.maxDistance ?? Infinity;

    const n0 = new Vector3();
    for (const p of points)
        n0.add(p);
    if (n0.lengthSq() < 1e-10)
        n0.set(0, 0, 1);
    n0.normalize();

    const { east, north } = tangentFrame(n0);
    let minU = Infinity, maxU = -Infinity, minW = Infinity, maxW = -Infinity;
    for (const p of points) {
        const u = p.dot(east), w = p.dot(north);
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minW = Math.min(minW, w); maxW = Math.max(maxW, w);
    }
    const normal = n0.clone().multiplyScalar(R);
    if (points.length) {
        normal.addScaledVector(east, (minU + maxU) / 2).addScaledVector(north, (minW + maxW) / 2);
    }
    normal.normalize();

    const tanV = Math.tan(opts.fov / 2 * Math.PI / 180) * margin;
    const tanH = tanV * opts.aspect;
    const near = 1;

    const solve = (tilt: number): Framing => {
        // 先用单位距离求方向，再按方向求距离
        const probe = poseFromBase(normal.clone().multiplyScalar(R + 1), R, tilt);
        const d = Math.min(Math.max(fitDistance(points, probe, tanV, tanH, near), minDistance), maxDistance);
        const base = normal.clone().multiplyScalar(R + d);
        return { ...poseFromBase(base, R, tilt), base };
    };

    const tilt = opts.tilt ?? 0;
    let f = solve(tilt);
    if (tilt !== 0 && opts.flattenBeyond !== undefined && f.distance > opts.flattenBeyond)
        f = solve(0);
    return f;
}
