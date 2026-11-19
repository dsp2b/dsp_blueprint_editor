import { PerspectiveCamera, Vector3 } from "three";
import { CameraRig } from "@/render/core/cameraRig";
import { MapControls } from "@/render/core/mapControls";

const R = 200.2;
const W = 1000, H = 800;

/** 只实现 MapControls 用到的部分：node 环境里没有 DOM */
function fakeElement() {
    const el = new EventTarget() as EventTarget & Record<string, unknown>;
    Object.assign(el, {
        style: {},
        clientHeight: H,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        hasPointerCapture: () => true,
    });
    return el as unknown as HTMLElement;
}

let time = 0;
function fire(el: EventTarget, type: string, props: Record<string, unknown>) {
    const e = new Event(type, { cancelable: true });
    time += 16;
    Object.defineProperty(e, 'timeStamp', { value: time });
    Object.assign(e, { button: 0, buttons: 1, pointerType: 'mouse', pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...props });
    el.dispatchEvent(e);
    return e;
}

function setup() {
    (globalThis as unknown as { window: EventTarget }).window ??= new EventTarget();
    const camera = new PerspectiveCamera(50, W / H, 0.5, 3000);
    camera.updateProjectionMatrix();
    const rig = new CameraRig(camera, R);
    rig.minDistance = R * 0.04;
    rig.maxDistance = R * 3;
    rig.flyTo({ normal: new Vector3(0.2, 0.4, 0.9), distance: 60, tilt: 0.3 }, true);
    const el = fakeElement();
    const controls = new MapControls(rig, el, fakeElement());
    controls.reducedMotion = true;
    return { rig, el, controls };
}

function touches(el: EventTarget, type: string, pts: [number, number][], ids = pts.map((_, i) => i + 1)) {
    pts.forEach(([x, y], i) => fire(el, type, { pointerType: 'touch', pointerId: ids[i], clientX: x, clientY: y }));
}

describe('MapControls', () => {
    test('left-drag pans: the grabbed ground follows the cursor', () => {
        const { rig, el, controls } = setup();
        const anchor = rig.hit(0, 0)!;
        fire(el, 'pointerdown', { clientX: W / 2, clientY: H / 2 });
        fire(el, 'pointermove', { clientX: W / 2 + 120, clientY: H / 2 + 60 });
        const p = anchor.clone().project((rig as unknown as { camera: PerspectiveCamera }).camera);
        expect(p.x).toBeCloseTo(0.24, 5);
        expect(p.y).toBeCloseTo(-0.15, 5);
        expect(controls.dragging).toBe(true);
        fire(el, 'pointerup', { clientX: W / 2 + 120, clientY: H / 2 + 60 });
        expect(controls.dragging).toBe(false);
    });

    test('right-drag turns and tilts without moving the target', () => {
        const { rig, el } = setup();
        const n0 = rig.normal.clone();
        const tilt0 = rig.tilt;
        fire(el, 'pointerdown', { button: 2, clientX: 500, clientY: 400 });
        fire(el, 'pointermove', { button: 2, clientX: 600, clientY: 350 });
        fire(el, 'pointerup', { button: 2, clientX: 600, clientY: 350 });
        expect(rig.heading).toBeLessThan(-0.3);  // 向右拖：朝向顺时针转
        expect(rig.tilt).toBeGreaterThan(tilt0);   // 向上拖：抬高视角
        expect(rig.normal.distanceTo(n0)).toBeLessThan(1e-9);
    });

    test('shift+left-drag turns like right-drag', () => {
        const { rig, el } = setup();
        fire(el, 'pointerdown', { shiftKey: true, clientX: 500, clientY: 400 });
        fire(el, 'pointermove', { shiftKey: true, clientX: 400, clientY: 400 });
        expect(rig.heading).toBeGreaterThan(0.3);
    });

    test('wheel zooms towards the cursor', () => {
        const { rig, el } = setup();
        fire(el, 'wheel', { clientX: 200, clientY: 200, deltaY: -200, deltaMode: 0 });
        expect(rig.distance).toBeLessThan(60);
    });

    test('pinch zooms and twist rotates', () => {
        const { rig, el } = setup();
        touches(el, 'pointerdown', [[450, 400], [550, 400]]);
        // 每根手指单独上报
        touches(el, 'pointermove', [[400, 380], [600, 420]]);
        touches(el, 'pointerup', [[400, 380], [600, 420]]);
        expect(rig.distance).toBeLessThan(40);
        expect(rig.heading).toBeGreaterThan(0.1);  // 手指顺时针转，场景跟着顺时针转
    });

    test('two fingers swiping up together tilt the view instead of panning', () => {
        const { rig, el } = setup();
        const n0 = rig.normal.clone();
        const tilt0 = rig.tilt;
        touches(el, 'pointerdown', [[450, 500], [550, 500]]);
        for (let i = 1; i <= 6; i++)
            touches(el, 'pointermove', [[450, 500 - i * 10], [550, 500 - i * 10]]);
        touches(el, 'pointerup', [[450, 440], [550, 440]]);
        expect(rig.tilt).toBeGreaterThan(tilt0 + 0.2);
        expect(rig.normal.distanceTo(n0)).toBeLessThan(1e-9);
    });

    test('lifting one finger continues as a one-finger pan', () => {
        const { rig, el } = setup();
        touches(el, 'pointerdown', [[450, 400], [550, 400]]);
        fire(el, 'pointerup', { pointerType: 'touch', pointerId: 2, clientX: 550, clientY: 400 });
        const n0 = rig.normal.clone();
        fire(el, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: 300, clientY: 400 });
        expect(rig.normal.distanceTo(n0)).toBeGreaterThan(1e-3);
    });

    test('a quick release keeps moving (inertia) unless reduced motion is on', () => {
        const { rig, el, controls } = setup();
        controls.reducedMotion = false;
        fire(el, 'pointerdown', { clientX: 500, clientY: 400 });
        for (let i = 1; i <= 5; i++)
            fire(el, 'pointermove', { clientX: 500 + i * 30, clientY: 400 });
        fire(el, 'pointerup', { clientX: 650, clientY: 400 });
        const n0 = rig.normal.clone();
        rig.update(1 / 60);
        expect(rig.normal.distanceTo(n0)).toBeGreaterThan(1e-5);
    });
});
