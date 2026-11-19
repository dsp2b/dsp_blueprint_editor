import { Matrix4, PerspectiveCamera, Quaternion, Ray, Sphere, Vector3 } from 'three';
import { CameraPose, forwardFromHeading, headingOf, poseFromView, tangentFrame } from './framing';

const FLY_SPEED = 1.8;          // 飞行动画每秒完成的比例
const ZOOM_SMOOTH = 18;         // 平滑缩放的收敛速度（1/秒）
const FLING_DECAY = 4;          // 惯性的衰减速度（1/秒）

export interface Shot {
    /** 注视点的法线（不必归一化） */
    normal: Vector3;
    /** 相机到注视点的距离 */
    distance: number;
    tilt: number;
    /** 朝向角，默认 0（朝北） */
    heading?: number;
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const ray = new Ray();
const sphere = new Sphere();

/**
 * 地图式相机：注视点在球面上（normal），相机在注视点"后方"上空，
 * 画面上方是切平面内的 forward 方向，倾斜 tilt 后看向注视点。
 *
 * 所有操作都立即写回相机，便于下一步按新相机做射线检测（拖动时让光标下的地面跟手）。
 */
export class CameraRig {
    readonly normal = new Vector3(0, 0, 1);
    readonly forward = new Vector3(0, 1, 0);
    distance: number;
    tilt = 0;

    minDistance = 0;
    maxDistance = Infinity;
    minTilt = 0;
    maxTilt = 75 / 180 * Math.PI;

    private anim: { from: Required<Shot>, to: Required<Shot>, k: number } | null = null;
    private fling: { axis: Vector3, speed: number } | null = null;
    private zoomPending = { log: 0, x: 0, y: 0, anchored: false };
    private version = 0;
    private reported = -1;
    private look = new Matrix4();
    pose: CameraPose;

    constructor(private camera: PerspectiveCamera, readonly R: number) {
        const p = camera.position.clone();
        if (p.lengthSq() < 1e-10)
            p.set(0, 0, 1);
        this.normal.copy(p).normalize();
        this.distance = Math.max(p.length() - R, 0);
        tangentFrame(this.normal, undefined, this.forward);
        this.pose = this.sync();
    }

    get animating() {
        return this.anim !== null;
    }

    /** 朝向角：0 为朝北，正值为从外面看逆时针 */
    get heading() {
        return headingOf(this.normal, this.forward);
    }

    // ───────── 基本操作 ─────────

    /** 把整个相机绕球心旋转 q（拖动地面） */
    rotateRig(q: Quaternion) {
        this.normal.applyQuaternion(q).normalize();
        this.forward.applyQuaternion(q);
        this.orthonormalize();
        this.changed();
    }

    /** 注视点朝画面方向移动：right/up 为画面右方/上方的弧度 */
    panAngles(right: number, up: number) {
        const pose = this.pose;
        tmpV.copy(pose.east).multiplyScalar(right).addScaledVector(pose.north, up);
        const angle = tmpV.length();
        if (angle < 1e-12)
            return;
        tmpV.crossVectors(this.normal, tmpV).normalize();
        this.rotateRig(tmpQ.setFromAxisAngle(tmpV, angle));
    }

    /** 按屏幕像素平移（光标不在地面上时的后备方案）；内容随光标移动 */
    panPixels(dx: number, dy: number, viewportHeight: number) {
        const perPixel = this.groundPerPixel(viewportHeight) / this.R;
        this.panAngles(-dx * perPixel, dy * perPixel);
    }

    /** 注视点附近每个屏幕像素对应的地面长度 */
    groundPerPixel(viewportHeight: number) {
        return this.distance * Math.tan(this.camera.fov / 2 * Math.PI / 180) * 2 / Math.max(viewportHeight, 1);
    }

    /** 转动朝向（正值从外面看逆时针）并改变俯仰角 */
    turn(dHeading: number, dTilt = 0) {
        if (dHeading !== 0) {
            this.forward.applyQuaternion(tmpQ.setFromAxisAngle(this.normal, dHeading));
            this.orthonormalize();
        }
        this.tilt = Math.min(this.maxTilt, Math.max(this.minTilt, this.tilt + dTilt));
        this.changed();
    }

    setHeading(heading: number) {
        forwardFromHeading(this.normal, heading, this.forward);
        this.changed();
    }

    /** 屏幕坐标（NDC，-1..1，y 向上）处的射线与星球的交点 */
    hit(x: number, y: number, out = new Vector3()) {
        ray.origin.setFromMatrixPosition(this.camera.matrixWorld);
        ray.direction.set(x, y, 0.5).unproject(this.camera).sub(ray.origin).normalize();
        sphere.radius = this.R;
        return ray.intersectSphere(sphere, out);
    }

    /**
     * 绕球心转动相机，让地面上的 anchor 点出现在屏幕 (x, y) 处。
     * 返回实际的旋转；该处看不到地面时返回 null。
     */
    grab(anchor: Vector3, x: number, y: number) {
        const h = this.hit(x, y, tmpV);
        if (h === null)
            return null;
        const q = new Quaternion().setFromUnitVectors(h.normalize(), anchor.clone().normalize());
        this.rotateRig(q);
        return q;
    }

    /** 距离乘以 factor；给了屏幕坐标时保持该处的地面不动 */
    zoom(factor: number, x?: number, y?: number) {
        const anchor = x !== undefined && y !== undefined ? this.hit(x, y) : null;
        const d = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * factor));
        if (d === this.distance)
            return;
        this.distance = d;
        this.changed();
        if (anchor !== null)
            this.grab(anchor, x!, y!);
    }

    /** 平滑缩放：log 为 ln(倍数)，在之后几帧内完成；instant 时立即完成 */
    zoomSmooth(log: number, x: number | undefined, y: number | undefined, instant: boolean) {
        this.anim = null;
        this.fling = null;
        if (instant) {
            this.zoom(Math.exp(log), x, y);
            return;
        }
        const z = this.zoomPending;
        z.log += log;
        z.anchored = x !== undefined && y !== undefined;
        z.x = x ?? 0;
        z.y = y ?? 0;
    }

    /** 松手后的惯性：axis 为旋转轴，speed 为弧度/秒 */
    startFling(axis: Vector3, speed: number) {
        this.fling = speed > 0 ? { axis: axis.clone().normalize(), speed } : null;
    }

    /** 飞到指定位置（朝向默认转回正北）；instant（减少动态效果）时直接跳过去 */
    flyTo(shot: Shot, instant: boolean) {
        this.fling = null;
        this.zoomPending.log = 0;
        const to: Required<Shot> = { normal: shot.normal.clone().normalize(), distance: shot.distance, tilt: shot.tilt, heading: shot.heading ?? 0 };
        if (instant) {
            this.anim = null;
            this.apply(to);
            return;
        }
        const from: Required<Shot> = { normal: this.normal.clone(), distance: this.distance, tilt: this.tilt, heading: this.heading };
        // 走较短的方向转回去
        const dh = to.heading - from.heading;
        to.heading = from.heading + Math.atan2(Math.sin(dh), Math.cos(dh));
        this.anim = { from, to, k: 0 };
    }

    /** 用户开始操作时停止飞行、惯性与平滑缩放 */
    stop() {
        this.anim = null;
        this.fling = null;
        this.zoomPending.log = 0;
    }

    // ───────── 每帧 ─────────

    /** 每帧调用；返回相机这一帧是否变化与当前姿态 */
    update(dt: number) {
        if (this.anim) {
            const a = this.anim;
            a.k = Math.min(1, a.k + dt * FLY_SPEED);
            const e = 1 - Math.pow(1 - a.k, 3);
            const n = new Vector3().lerpVectors(a.from.normal, a.to.normal, e);
            if (n.lengthSq() < 1e-8)  // 正好飞到对面
                n.copy(a.to.normal);
            this.apply({
                normal: n,
                distance: a.from.distance * (1 - e) + a.to.distance * e,
                tilt: a.from.tilt * (1 - e) + a.to.tilt * e,
                heading: a.from.heading * (1 - e) + a.to.heading * e,
            });
            if (a.k >= 1)
                this.anim = null;
        }

        const z = this.zoomPending;
        if (z.log !== 0) {
            let step = z.log * (1 - Math.exp(-dt * ZOOM_SMOOTH));
            if (Math.abs(z.log - step) < 1e-4)
                step = z.log;
            z.log -= step;
            const before = this.distance;
            if (z.anchored)
                this.zoom(Math.exp(step), z.x, z.y);
            else
                this.zoom(Math.exp(step));
            if (this.distance === before)  // 到了距离上下限
                z.log = 0;
        }

        if (this.fling) {
            const f = this.fling;
            this.rotateRig(tmpQ.setFromAxisAngle(f.axis, f.speed * dt));
            f.speed *= Math.exp(-dt * FLING_DECAY);
            // 注视点附近的地面速度小于每秒 2% 画面高度时停下
            if (f.speed * this.R < this.distance * 0.02)
                this.fling = null;
        }

        const changed = this.reported !== this.version;
        this.reported = this.version;
        return { changed, pose: this.pose };
    }

    // ───────── 内部 ─────────

    private apply(s: Required<Shot>) {
        this.normal.copy(s.normal).normalize();
        this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, s.distance));
        this.tilt = Math.min(this.maxTilt, Math.max(this.minTilt, s.tilt));
        forwardFromHeading(this.normal, s.heading, this.forward);
        this.changed();
    }

    private orthonormalize() {
        this.forward.addScaledVector(this.normal, -this.forward.dot(this.normal));
        if (this.forward.lengthSq() < 1e-10)
            tangentFrame(this.normal, undefined, this.forward);
        this.forward.normalize();
    }

    private changed() {
        this.version++;
        this.pose = this.sync();
    }

    /** 把当前状态写回相机 */
    private sync() {
        const pose = poseFromView(this.normal, this.forward, this.R, this.distance, this.tilt);
        const camera = this.camera;
        camera.position.copy(pose.position);
        camera.up.copy(pose.up);
        this.look.lookAt(pose.position, pose.target, pose.up);
        camera.quaternion.setFromRotationMatrix(this.look);
        camera.updateMatrixWorld();
        return pose;
    }
}
