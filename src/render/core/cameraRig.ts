import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { PlanetMapControls } from '@/PlanetMapControls';
import { poseFromBase } from './framing';

const FLY_SPEED = 1.8;  // 每秒完成的比例

interface Shot {
    base: Vector3;
    tilt: number;
}

/**
 * 在 PlanetMapControls（相机始终看向球心）之上加俯仰角与飞行动画。
 * 控制器只看到 base 位置；每帧渲染前把相机换成带俯仰角的姿态。
 */
export class CameraRig {
    tilt = 0;
    private base = new Vector3();
    private anim: { from: Shot, to: Shot, k: number } | null = null;
    private look = new Matrix4();
    private lastTilt = NaN;

    constructor(private camera: PerspectiveCamera, private controls: PlanetMapControls, private R: number) {
        this.base.copy(camera.position);
    }

    get animating() {
        return this.anim !== null;
    }

    /** 飞到 base/tilt；instant（减少动态效果）时直接跳过去 */
    flyTo(base: Vector3, tilt: number, instant: boolean) {
        if (instant) {
            this.anim = null;
            this.base.copy(base);
            this.tilt = tilt;
            return;
        }
        this.anim = { from: { base: this.base.clone(), tilt: this.tilt }, to: { base: base.clone(), tilt }, k: 0 };
    }

    /** 用户开始拖动/缩放时停止飞行，停在当前位置 */
    stop() {
        this.anim = null;
    }

    /** 每帧调用；返回相机是否变化 */
    update(dt: number) {
        const camera = this.camera;
        if (this.anim) {
            const a = this.anim;
            a.k = Math.min(1, a.k + dt * FLY_SPEED);
            const e = 1 - Math.pow(1 - a.k, 3);
            const len = a.from.base.length() * (1 - e) + a.to.base.length() * e;
            this.base.lerpVectors(a.from.base.clone().normalize(), a.to.base.clone().normalize(), e);
            if (this.base.lengthSq() < 1e-8)  // 正好飞到对面
                this.base.copy(a.to.base);
            this.base.normalize().multiplyScalar(len);
            this.tilt = a.from.tilt * (1 - e) + a.to.tilt * e;
            if (a.k >= 1)
                this.anim = null;
        }
        // 控制器按 base 计算拖动/缩放
        camera.position.copy(this.base);
        let changed = this.controls.update();
        this.base.copy(camera.position);

        const pose = poseFromBase(this.base, this.R, this.tilt);
        camera.position.copy(pose.position);
        this.look.lookAt(pose.position, pose.target, pose.up);
        camera.quaternion.setFromRotationMatrix(this.look);
        camera.updateMatrixWorld();
        if (this.tilt !== this.lastTilt) {
            this.lastTilt = this.tilt;
            changed = true;
        }
        return { changed, pose };
    }
}
