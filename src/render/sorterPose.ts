import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * 分拣器姿态（纯函数，只依赖 three）。
 *
 * 约定（与游戏 InserterRenderer 一致）：
 * - A 端 = 取货端（blueprint localOffset[0]），B 端 = 放货端（localOffset[1]）；
 * - 每端一个坐标系，+Y 向上、+Z（fwd）朝着 A→B，这里的矩阵是 glTF 轴向的世界矩阵：
 *   模型几何（glTF 坐标，每个部件相对自己所在端）左乘它即得到世界位置；
 * - t1 = 1 表示取货端连着建筑（不是传送带），t2 = 1 表示放货端连着建筑；
 * - ATop = A + up + fwdA·1.03·t1，BTop = B + up − fwdB·1.03·t2；
 * - 抓手沿折线 [A+up, ATop, BTop, B+up] 按弧长运动，朝向跟 A 端。
 */

/** 连着建筑时，顶梁从端点向分拣器内侧缩进的距离（米，来自游戏 InserterRenderer） */
export const TOP_REACH = 1.03;
/** 模型里烘焙的默认姿态：A=(0,0,0) B=(0,0,2)，t1=t2=1，此时的 ATop / BTop（glTF 坐标，A 端原点） */
const BAKED_A_TOP = new Vector3(0, 1, TOP_REACH);
const BAKED_B_TOP = new Vector3(0, 1, 2 - TOP_REACH);
/** 动画停止（关闭流向或减少动态效果）时抓手所在的相位：A→B 途中的一半，带着货物 */
export const PARKED_PHASE = 0.25;
/** 游戏每个 tick 给动画时间加 10000（满电），一个 tick 1/60 秒 */
const TIME_PER_TICK = 10000;
const TICKS_PER_SECOND = 60;

/**
 * glTF 模型空间 → 建筑本地空间：本地 (x, y, z) = glTF (−x, z, y)。
 * 与 real/buildings.ts 的 GLTF_TO_LOCAL 相同（那里依赖加载器，纯模块不能引用）。
 */
export const GLTF_TO_LOCAL = new Matrix4().set(
    -1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

const AXIS_Z = new Vector3(0, 0, 1);
const euler = new Euler();
const qUnity = new Quaternion();
const qLocal = new Quaternion();
const qYaw = new Quaternion();
const mSurface = new Matrix4();
const mLocal = new Matrix4();

/**
 * 分拣器一端的 glTF 轴向世界矩阵。
 * transform 是 calcBuildingTrans 给出的这一端的变换（位置、球面朝向，加绕本地 z 的 −yaw）；
 * 游戏里分拣器端点的朝向是 球面朝向 × Quaternion.Euler(pitch, yaw, tilt)（Unity 的 Y·X·Z 顺序），
 * 把它按 本地 = Unity (x, z, y)（游戏的左手系 → 预览的右手系）换基：四元数 (qx,qy,qz,qw) → (−qx,−qz,−qy,qw)，
 * pitch=tilt=0 时就是 transform 自己的朝向。角度单位为度。
 */
export function endFrame(transform: Matrix4, yawDeg: number, tiltDeg: number, pitchDeg: number): Matrix4 {
    const rad = Math.PI / 180;
    euler.set(pitchDeg * rad, yawDeg * rad, tiltDeg * rad, 'YXZ');
    qUnity.setFromEuler(euler);
    qLocal.set(-qUnity.x, -qUnity.z, -qUnity.y, qUnity.w);
    // 去掉 transform 里的 −yaw（绕本地 z），换成上面完整的 pitch/yaw/tilt
    qYaw.setFromAxisAngle(AXIS_Z, yawDeg * rad);
    mSurface.copy(transform).multiply(mLocal.makeRotationFromQuaternion(qYaw));
    return mSurface.clone().multiply(mLocal.makeRotationFromQuaternion(qLocal)).multiply(GLTF_TO_LOCAL);
}
/** 这一端连着建筑（而不是传送带或悬空）时为 1；游戏对传送带写 −1 槽位，仍要排除指向传送带的情况 */
export function connectsToBuilding(objIdx: number, slot: number, targetIsBelt: boolean): 0 | 1 {
    return objIdx >= 0 && slot >= 0 && !targetIsBelt ? 1 : 0;
}

/**
 * 抓手一个往返（A→B→A）的时长（秒）。inserterSTT 是单程的时间量，每 tick 前进 10000，
 * 一个 tick 1/60 秒：Mk.I 200000 → 往返 40 tick ≈ 0.67 s，集装分拣器 30000 → 6 tick = 0.1 s。
 */
export function cycleSeconds(inserterSTT: number) {
    return 2 * inserterSTT / TIME_PER_TICK / TICKS_PER_SECOND;
}

/** 动画相位 [0,1)：0 在 A、0.5 在 B；offset 让不同分拣器错开 */
export function grabberPhase(timeSeconds: number, cycle: number, offset = 0) {
    const p = (timeSeconds / cycle + offset) % 1;
    return p < 0 ? p + 1 : p;
}

/** 抓手在折线上的弧长比例：s = 1 − 2|frac(phase) − 0.5|，A→B 再 B→A */
export function grabberS(phase: number) {
    const f = phase - Math.floor(phase);
    return 1 - 2 * Math.abs(f - 0.5);
}

/** 相位在 A→B 途中（抓手带着货物）时为 true，回程是空的 */
export function isLoaded(phase: number) {
    const f = phase - Math.floor(phase);
    return f < 0.5;
}

/** 折线上按弧长比例 s（0..1）的点；总长为 0 时返回起点 */
export function pointAlong(points: readonly Vector3[], s: number, out = new Vector3()): Vector3 {
    let total = 0;
    for (let i = 1; i < points.length; i++)
        total += points[i].distanceTo(points[i - 1]);
    if (!(total > 0))
        return out.copy(points[0]);
    let left = Math.min(Math.max(s, 0), 1) * total;
    for (let i = 1; i < points.length; i++) {
        const len = points[i].distanceTo(points[i - 1]);
        if (left <= len || i === points.length - 1)
            return out.lerpVectors(points[i - 1], points[i], len > 0 ? Math.min(left / len, 1) : 0);
        left -= len;
    }
    return out.copy(points[points.length - 1]);
}

export interface SorterShape {
    aFrame: Matrix4;
    bFrame: Matrix4;
    aTop: Vector3;
    bTop: Vector3;
    aRail: boolean;
    bRail: boolean;
    /** 顶梁 / 箭头的烘焙顶点（glTF 坐标）→ 世界，下标为 _FRAME 属性值（0 = ATop，1 = BTop） */
    stretch: [Matrix4, Matrix4];
    /** 箭头贴图沿 v 的平铺长度（米）：|ATop − BTop| + 1 */
    arrowLength: number;
    /** [A 抬高, ATop, BTop, B 抬高] */
    polyline: [Vector3, Vector3, Vector3, Vector3];
}

export interface SorterPose extends SorterShape {
    phase: number;
    grabberS: number;
    /** 抓手的世界矩阵（glTF 轴向，位置在折线上，朝向跟 A 端） */
    grabber: Matrix4;
    loaded: boolean;
}

const rotA = new Matrix4();
const rotB = new Matrix4();

function stretchMatrix(top: Vector3, frame: Matrix4, baked: Vector3) {
    const rot = new Matrix4().extractRotation(frame);
    return new Matrix4().makeTranslation(top.x, top.y, top.z).multiply(rot).multiply(new Matrix4().makeTranslation(-baked.x, -baked.y, -baked.z));
}

/** 与相位无关的部分：端点、护轨、顶梁与箭头的拉伸、抓手折线 */
export function sorterShape(a: Matrix4, b: Matrix4, t1: 0 | 1, t2: 0 | 1): SorterShape {
    rotA.extractRotation(a);
    rotB.extractRotation(b);
    const posA = new Vector3().setFromMatrixPosition(a);
    const posB = new Vector3().setFromMatrixPosition(b);
    const upA = new Vector3(0, 1, 0).applyMatrix4(rotA);
    const upB = new Vector3(0, 1, 0).applyMatrix4(rotB);
    const fwdA = new Vector3(0, 0, 1).applyMatrix4(rotA);
    const fwdB = new Vector3(0, 0, 1).applyMatrix4(rotB);
    const aTop = posA.clone().add(upA).addScaledVector(fwdA, TOP_REACH * t1);
    const bTop = posB.clone().add(upB).addScaledVector(fwdB, -TOP_REACH * t2);
    return {
        aFrame: a.clone(),
        bFrame: b.clone(),
        aTop,
        bTop,
        aRail: t1 === 1,
        bRail: t2 === 1,
        stretch: [stretchMatrix(aTop, a, BAKED_A_TOP), stretchMatrix(bTop, b, BAKED_B_TOP)],
        arrowLength: aTop.distanceTo(bTop) + 1,
        polyline: [posA.clone().add(upA), aTop.clone(), bTop.clone(), posB.clone().add(upB)],
    };
}

const point = new Vector3();
const quat = new Quaternion();
const ONE = new Vector3(1, 1, 1);

/** 某个相位时抓手的世界矩阵写进 out，返回是否带着货物 */
export function grabberAt(shape: SorterShape, phase: number, out: Matrix4): boolean {
    pointAlong(shape.polyline, grabberS(phase), point);
    quat.setFromRotationMatrix(rotA.extractRotation(shape.aFrame));
    out.compose(point, quat, ONE);
    return isLoaded(phase);
}

/** 两端 + 连接状态 + 动画相位 → 各部件的姿态 */
export function poseSorter(a: Matrix4, b: Matrix4, t1: 0 | 1, t2: 0 | 1, phase: number): SorterPose {
    const shape = sorterShape(a, b, t1, t2);
    const grabber = new Matrix4();
    const loaded = grabberAt(shape, phase, grabber);
    return { ...shape, phase, grabberS: grabberS(phase), grabber, loaded };
}

/** 烘焙的顶梁/箭头顶点（glTF 坐标）按所属端（_FRAME）拉伸后的世界位置 */
export function stretchVertex(shape: Pick<SorterShape, 'stretch'>, frame: 0 | 1, v: Vector3, out = new Vector3()): Vector3 {
    return out.copy(v).applyMatrix4(shape.stretch[frame]);
}
