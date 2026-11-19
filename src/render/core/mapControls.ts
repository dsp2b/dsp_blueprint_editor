import { Quaternion, Vector3 } from 'three';
import { CameraRig } from './cameraRig';

/** 右键/中键拖动：每像素转动的弧度 */
const TURN_PER_PX = 0.006;
const TILT_PER_PX = 0.005;
/** 键盘：平移（每秒移动的画面高度比例）、转动（弧度/秒）、缩放（ln 倍数/秒） */
const KEY_PAN = 0.9;
const KEY_TURN = 1.6;
const KEY_ZOOM = 1.8;
/** 双指手势判定为"俯仰"还是"平移缩放旋转"之前需要的移动量（像素） */
const TOUCH_DECIDE = 8;
const TOUCH_TILT_PER_PX = 0.006;
/** 松手前这么久没动就不产生惯性（毫秒） */
const FLING_IDLE = 60;
const FLING_MAX = 3;  // 弧度/秒

type Drag =
    | { kind: 'pan', anchor: Vector3 | null, x: number, y: number }
    | { kind: 'turn', x: number, y: number }
    | { kind: 'touch2', anchor: Vector3 | null, mode: 'undecided' | 'map' | 'tilt',
        start: Map<number, { x: number, y: number }>, mid: { x: number, y: number }, dist: number, angle: number };

const PAN_KEYS: Record<string, [number, number]> = {
    KeyW: [0, 1], ArrowUp: [0, 1],
    KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
};
const TURN_KEYS: Record<string, number> = { KeyQ: 1, KeyE: -1 };
const ZOOM_KEYS: Record<string, number> = { Equal: -1, NumpadAdd: -1, Minus: 1, NumpadSubtract: 1 };

function isTyping(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}

/**
 * 地图式操作：
 * - 左键拖动平移（光标下的地面跟手），右键/中键或 Shift/Ctrl+左键拖动：左右转动朝向、上下改变俯仰
 * - 滚轮/触控板捏合朝光标缩放，双击放大（Shift+双击缩小）
 * - 单指平移；双指捏合缩放、旋转、平移，双指同向上下滑动改变俯仰
 * - WASD/方向键平移，Q/E 转动，+/- 缩放
 */
export class MapControls {
    enabled = true;
    /** 减少动态效果：不做平滑缩放与惯性 */
    reducedMotion = false;

    private pointers = new Map<number, { x: number, y: number, type: string }>();
    private drag: Drag | null = null;
    private downKeys = new Set<string>();
    private velocity = { axis: new Vector3(), speed: 0, t: 0 };
    private cleanups: (() => void)[] = [];

    constructor(private rig: CameraRig, private el: HTMLElement, keyTarget: HTMLElement) {
        el.style.touchAction = 'none';
        this.on(el, 'pointerdown', this.onPointerDown);
        this.on(el, 'pointermove', this.onPointerMove);
        this.on(el, 'pointerup', this.onPointerUp);
        this.on(el, 'pointercancel', this.onPointerUp);
        this.on(el, 'lostpointercapture', this.onPointerUp);
        this.on(el, 'wheel', this.onWheel, { passive: false });
        this.on(el, 'dblclick', this.onDblClick);
        this.on(el, 'contextmenu', (e: Event) => e.preventDefault());
        this.on(keyTarget, 'keydown', this.onKeyDown);
        this.on(keyTarget, 'keyup', this.onKeyUp);
        this.on(keyTarget, 'focusout', this.clearKeys);
        this.on(window, 'blur', this.clearKeys);
    }

    /** 正在拖动（用来显示"抓取中"的光标） */
    get dragging() {
        return this.drag !== null;
    }

    dispose() {
        for (const off of this.cleanups)
            off();
        this.cleanups = [];
    }

    /** 每帧调用，处理按住的按键 */
    update(dt: number) {
        if (!this.enabled || this.downKeys.size === 0 || dt === 0)
            return;
        let px = 0, py = 0, turn = 0, zoom = 0;
        for (const code of this.downKeys) {
            const p = PAN_KEYS[code];
            if (p) {
                px += p[0];
                py += p[1];
            }
            turn += TURN_KEYS[code] ?? 0;
            zoom += ZOOM_KEYS[code] ?? 0;
        }
        const rig = this.rig;
        if (px !== 0 || py !== 0) {
            const len = Math.hypot(px, py);
            const step = rig.groundPerPixel(this.el.clientHeight) * this.el.clientHeight * KEY_PAN * dt / rig.R / len;
            rig.panAngles(px * step, py * step);
        }
        if (turn !== 0)
            rig.turn(turn * KEY_TURN * dt);
        if (zoom !== 0)
            rig.zoom(Math.exp(zoom * KEY_ZOOM * dt));
    }

    // ───────── 指针 ─────────

    private ndc(x: number, y: number): [number, number] {
        const rect = this.el.getBoundingClientRect();
        return [(x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1];
    }

    private hitAt(x: number, y: number) {
        const [nx, ny] = this.ndc(x, y);
        return this.rig.hit(nx, ny);
    }

    private onPointerDown = (e: PointerEvent) => {
        if (!this.enabled)
            return;
        this.rig.stop();
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
        try {
            this.el.setPointerCapture(e.pointerId);
        } catch {
            // 合成事件没有真实指针
        }

        if (e.pointerType === 'touch') {
            this.beginTouch();
            return;
        }
        if (this.pointers.size > 1)
            return;
        const turn = e.button === 1 || e.button === 2 || (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey));
        if (turn) {
            this.drag = { kind: 'turn', x: e.clientX, y: e.clientY };
            e.preventDefault();  // 中键不要进入浏览器的自动滚动
        } else if (e.button === 0) {
            this.beginPan(e.clientX, e.clientY);
        }
    };

    private beginPan(x: number, y: number) {
        this.drag = { kind: 'pan', anchor: this.hitAt(x, y), x, y };
        this.velocity.speed = 0;
    }

    private beginTouch() {
        const touches = [...this.pointers.values()].filter(p => p.type === 'touch');
        if (touches.length === 1) {
            this.beginPan(touches[0].x, touches[0].y);
        } else if (touches.length >= 2) {
            const g = this.touchGeometry();
            this.drag = {
                kind: 'touch2', anchor: this.hitAt(g.mid.x, g.mid.y), mode: 'undecided',
                start: new Map([...this.pointers].filter(([, p]) => p.type === 'touch').slice(0, 2).map(([id, p]) => [id, { x: p.x, y: p.y }])),
                ...g,
            };
        }
    }

    /** 前两个触点的中点、距离与角度 */
    private touchGeometry() {
        const [a, b] = [...this.pointers.values()].filter(p => p.type === 'touch');
        return {
            mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            dist: Math.hypot(b.x - a.x, b.y - a.y),
            angle: Math.atan2(b.y - a.y, b.x - a.x),
        };
    }

    private onPointerMove = (e: PointerEvent) => {
        const p = this.pointers.get(e.pointerId);
        if (!p)
            return;
        p.x = e.clientX;
        p.y = e.clientY;
        const drag = this.drag;
        if (!this.enabled || !drag)
            return;
        const rig = this.rig;

        if (drag.kind === 'pan') {
            this.panTo(drag, e.clientX, e.clientY, e.timeStamp);
        } else if (drag.kind === 'turn') {
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX;
            drag.y = e.clientY;
            // 向右拖：场景跟着鼠标向右转；向上拖：抬起视角看向地平线
            rig.turn(-dx * TURN_PER_PX, -dy * TILT_PER_PX);
        } else {
            this.touchMove(drag);
        }
    };

    /** 平移到 (x, y)：优先让抓住的地面跟手，抓不到地面时按像素平移 */
    private panTo(drag: Extract<Drag, { kind: 'pan' }>, x: number, y: number, time: number) {
        const rig = this.rig;
        const [nx, ny] = this.ndc(x, y);
        let q: Quaternion | null = null;
        if (drag.anchor !== null)
            q = rig.grab(drag.anchor, nx, ny);
        if (q === null) {
            // 光标移到了地平线以外：按像素平移，回到地面上时重新抓取
            const before = rig.normal.clone();
            rig.panPixels(x - drag.x, y - drag.y, this.el.clientHeight);
            q = new Quaternion().setFromUnitVectors(before, rig.normal);
            drag.anchor = rig.hit(nx, ny);
        }
        drag.x = x;
        drag.y = y;
        this.trackVelocity(q, time);
    }

    private trackVelocity(q: Quaternion, time: number) {
        const v = this.velocity;
        const dt = Math.max((time - v.t) / 1000, 0.004);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        const speed = Math.min(angle / dt, FLING_MAX);
        if (angle > 1e-9) {
            const axis = new Vector3(q.x, q.y, q.z).multiplyScalar(Math.sign(q.w) || 1).normalize();
            // 平滑一下，避免最后一个事件的抖动决定惯性
            if (v.speed > 0 && time - v.t < FLING_IDLE) {
                v.axis.multiplyScalar(v.speed).lerp(axis.multiplyScalar(speed), 0.6);
                v.speed = v.axis.length();
                v.axis.normalize();
            } else {
                v.axis.copy(axis);
                v.speed = speed;
            }
        }
        v.t = time;
    }

    private touchMove(drag: Extract<Drag, { kind: 'touch2' }>) {
        if (this.pointers.size < 2)
            return;
        const rig = this.rig;
        const g = this.touchGeometry();
        if (drag.mode === 'undecided') {
            const moves = [...drag.start].map(([id, s]) => {
                const p = this.pointers.get(id);
                return p ? { dx: p.x - s.x, dy: p.y - s.y } : { dx: 0, dy: 0 };
            });
            // 两根手指的移动是分开上报的：等两指都动了再判定（只动一指且动得很多时直接判定）
            const lens = moves.map(m => Math.hypot(m.dx, m.dy));
            const enough = Math.max(...lens) >= TOUCH_DECIDE && Math.min(...lens) >= TOUCH_DECIDE / 2;
            if (!enough && Math.max(...lens) < TOUCH_DECIDE * 3)
                return;
            const [a, b] = moves;
            const vertical = (m: { dx: number, dy: number }) => Math.abs(m.dy) > Math.abs(m.dx) * 1.5 && Math.abs(m.dy) >= TOUCH_DECIDE / 2;
            // 两指同向上下滑动、间距基本不变：调俯仰
            drag.mode = vertical(a) && vertical(b) && Math.sign(a.dy) === Math.sign(b.dy) && Math.abs(g.dist - drag.dist) < TOUCH_DECIDE * 2
                ? 'tilt' : 'map';
        }
        if (drag.mode === 'tilt') {
            rig.turn(0, -(g.mid.y - drag.mid.y) * TOUCH_TILT_PER_PX);
        } else {
            if (g.dist > 1 && drag.dist > 1)
                rig.zoom(drag.dist / g.dist);
            // 手指顺时针转（屏幕 y 向下时角度增大），场景跟着顺时针转
            let da = g.angle - drag.angle;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            rig.turn(da);
            // 缩放与旋转之后，把双指中点下的地面放回中点
            if (drag.anchor !== null) {
                const [nx, ny] = this.ndc(g.mid.x, g.mid.y);
                if (rig.grab(drag.anchor, nx, ny) === null)
                    drag.anchor = null;
            } else {
                rig.panPixels(g.mid.x - drag.mid.x, g.mid.y - drag.mid.y, this.el.clientHeight);
                drag.anchor = this.hitAt(g.mid.x, g.mid.y);
            }
        }
        drag.mid = g.mid;
        drag.dist = g.dist;
        drag.angle = g.angle;
    }

    private onPointerUp = (e: PointerEvent) => {
        if (!this.pointers.has(e.pointerId))
            return;
        this.pointers.delete(e.pointerId);
        try {
            if (this.el.hasPointerCapture?.(e.pointerId))
                this.el.releasePointerCapture(e.pointerId);
        } catch {
            // 忽略
        }
        const drag = this.drag;
        if (drag?.kind === 'touch2') {
            // 抬起一根手指：剩下的手指继续平移
            this.drag = null;
            this.beginTouch();
            this.velocity.speed = 0;
            return;
        }
        if (this.pointers.size > 0)
            return;
        this.drag = null;
        const v = this.velocity;
        if (drag?.kind === 'pan' && !this.reducedMotion && v.speed > 0 && e.timeStamp - v.t < FLING_IDLE)
            this.rig.startFling(v.axis, v.speed);
        v.speed = 0;
    };

    private onWheel = (e: WheelEvent) => {
        if (!this.enabled)
            return;
        e.preventDefault();
        // deltaMode：0 像素，1 行，2 页
        let delta = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
        // 触控板捏合（浏览器以 ctrl+滚轮上报）的增量很小
        if (e.ctrlKey)
            delta *= 6;
        delta = Math.max(-400, Math.min(400, delta));
        const [nx, ny] = this.ndc(e.clientX, e.clientY);
        this.rig.zoomSmooth(delta * 0.0015, nx, ny, this.reducedMotion);
    };

    private onDblClick = (e: MouseEvent) => {
        if (!this.enabled)
            return;
        const [nx, ny] = this.ndc(e.clientX, e.clientY);
        this.rig.zoomSmooth(Math.log(e.shiftKey ? 2 : 0.5), nx, ny, this.reducedMotion);
    };

    // ───────── 键盘 ─────────

    private onKeyDown = (e: KeyboardEvent) => {
        if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target))
            return;
        if (e.code in PAN_KEYS || e.code in TURN_KEYS || e.code in ZOOM_KEYS) {
            if (!this.downKeys.has(e.code))
                this.rig.stop();
            this.downKeys.add(e.code);
            e.preventDefault();
        }
    };

    private onKeyUp = (e: KeyboardEvent) => {
        this.downKeys.delete(e.code);
    };

    private clearKeys = () => {
        this.downKeys.clear();
    };

    private on<K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) {
        const listener = fn as EventListener;
        target.addEventListener(type, listener, opts);
        this.cleanups.push(() => target.removeEventListener(type, listener, opts));
    }
}
