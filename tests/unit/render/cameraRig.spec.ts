import { PerspectiveCamera, Vector3 } from "three";
import { CameraRig } from "@/render/core/cameraRig";
import { forwardFromHeading, headingOf, poseFromBase, poseFromView, tangentFrame } from "@/render/core/framing";

const R = 200.2;

function makeRig(normal = new Vector3(0.3, 0.5, 0.8), distance = 60, tilt = 0.6) {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.5, 3000);
    camera.updateProjectionMatrix();
    const rig = new CameraRig(camera, R);
    rig.minDistance = R * 0.04;
    rig.maxDistance = R * 3;
    rig.flyTo({ normal, distance, tilt }, true);
    return { camera, rig };
}

/** 世界坐标点投影到 NDC */
function project(camera: PerspectiveCamera, p: Vector3) {
    return p.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
}

function expectOrthonormal(rig: CameraRig) {
    expect(rig.normal.length()).toBeCloseTo(1, 9);
    expect(rig.forward.length()).toBeCloseTo(1, 9);
    expect(rig.forward.dot(rig.normal)).toBeCloseTo(0, 9);
}

describe('framing helpers', () => {
    test('poseFromView facing north equals poseFromBase', () => {
        const base = new Vector3(10, 120, 150).normalize().multiplyScalar(R + 50);
        const a = poseFromBase(base, R, 0.5);
        const { north } = tangentFrame(base.clone().normalize());
        const b = poseFromView(base, north, R, 50, 0.5);
        expect(b.position.distanceTo(a.position)).toBeLessThan(1e-9);
        expect(b.up.distanceTo(a.up)).toBeLessThan(1e-9);
    });

    test('heading and forward round-trip', () => {
        const n = new Vector3(-0.4, 0.2, 0.9).normalize();
        for (const h of [0, 0.3, -1.2, 2.9, -3.1]) {
            const f = forwardFromHeading(n, h);
            expect(f.dot(n)).toBeCloseTo(0, 9);
            expect(headingOf(n, f)).toBeCloseTo(h, 9);
        }
    });

    test('positive heading turns forward counter-clockwise seen from outside (towards west)', () => {
        const n = new Vector3(0, 0, 1);
        const { east } = tangentFrame(n);
        expect(forwardFromHeading(n, Math.PI / 2).dot(east)).toBeCloseTo(-1, 9);
    });
});

describe('CameraRig', () => {
    test('flyTo instant puts the target under the screen centre, facing north', () => {
        const n = new Vector3(0.3, 0.5, 0.8).normalize();
        const { camera, rig } = makeRig(n, 60, 0.6);
        const c = project(camera, n.clone().multiplyScalar(R));
        expect(Math.abs(c.x)).toBeLessThan(1e-6);
        expect(Math.abs(c.y)).toBeLessThan(1e-6);
        expect(rig.heading).toBeCloseTo(0, 9);
        expect(rig.distance).toBe(60);
        expect(rig.tilt).toBe(0.6);
    });

    test('grab keeps the grabbed ground point under the cursor', () => {
        const { camera, rig } = makeRig();
        const anchor = rig.hit(0.2, -0.3)!;
        expect(anchor).not.toBeNull();
        for (const [x, y] of [[0.5, -0.1], [-0.4, 0.2], [0.1, -0.8]]) {
            expect(rig.grab(anchor, x, y)).not.toBeNull();
            const p = project(camera, anchor);
            expect(p.x).toBeCloseTo(x, 6);
            expect(p.y).toBeCloseTo(y, 6);
            expectOrthonormal(rig);
        }
    });

    test('grab returns null when the cursor is above the horizon', () => {
        const { rig } = makeRig(undefined, 60, 1.3);
        const anchor = rig.hit(0, 0)!;
        expect(rig.grab(anchor, 0, 1)).toBeNull();
    });

    test('zooming at the cursor keeps the ground under it', () => {
        const { camera, rig } = makeRig();
        const anchor = rig.hit(-0.5, 0.4)!;
        rig.zoom(0.5, -0.5, 0.4);
        expect(rig.distance).toBeCloseTo(30, 9);
        const p = project(camera, anchor);
        expect(p.x).toBeCloseTo(-0.5, 5);
        expect(p.y).toBeCloseTo(0.4, 5);
    });

    test('zoom is clamped to the distance limits', () => {
        const { rig } = makeRig();
        rig.zoom(1e-6);
        expect(rig.distance).toBeCloseTo(R * 0.04, 9);
        rig.zoom(1e6);
        expect(rig.distance).toBeCloseTo(R * 3, 9);
    });

    test('smooth zoom converges over a few frames', () => {
        const { rig } = makeRig();
        rig.zoomSmooth(Math.log(2), 0, 0, false);
        for (let i = 0; i < 60; i++)
            rig.update(1 / 60);
        expect(rig.distance).toBeCloseTo(120, 3);
    });

    test('turn rotates the heading around the target and clamps the tilt', () => {
        const n = new Vector3(0.3, 0.5, 0.8).normalize();
        const { camera, rig } = makeRig(n);
        rig.turn(0.7, 10);
        expect(rig.heading).toBeCloseTo(0.7, 9);
        expect(rig.tilt).toBe(rig.maxTilt);
        // 注视点不动
        const c = project(camera, n.clone().multiplyScalar(R));
        expect(Math.abs(c.x)).toBeLessThan(1e-6);
        expect(Math.abs(c.y)).toBeLessThan(1e-6);
        rig.turn(0, -10);
        expect(rig.tilt).toBe(rig.minTilt);
    });

    test('panning across the pole stays well-defined and does not spin the view', () => {
        const { rig } = makeRig(new Vector3(0, 1, 0.05), 40, 0);
        const before = rig.forward.clone();
        for (let i = 0; i < 20; i++)
            rig.panAngles(0, 0.01);
        expectOrthonormal(rig);
        // 刚体转动：forward 只随注视点平移，夹角和移动角度一致
        expect(rig.forward.angleTo(before)).toBeCloseTo(0.2, 6);
        expect(Number.isFinite(rig.heading)).toBe(true);
    });

    test('pixel pan moves the content with the cursor', () => {
        const { camera, rig } = makeRig(undefined, 60, 0);
        const p0 = rig.pose.target.clone();
        rig.panPixels(100, 0, 800);
        // 内容向右移：原来的注视点出现在画面右侧
        expect(project(camera, p0).x).toBeGreaterThan(0);
    });

    test('flyTo animates and turns back to north the short way', () => {
        const { rig } = makeRig();
        rig.turn(-2.5);
        const n = new Vector3(-0.2, 0.1, 0.95);
        rig.flyTo({ normal: n, distance: 80, tilt: 0.3 }, false);
        let last = rig.heading;
        let maxStep = 0;
        for (let i = 0; i < 120 && rig.animating; i++) {
            rig.update(1 / 60);
            maxStep = Math.max(maxStep, Math.abs(rig.heading - last));
            last = rig.heading;
        }
        expect(rig.animating).toBe(false);
        expect(rig.heading).toBeCloseTo(0, 9);
        expect(rig.normal.distanceTo(n.clone().normalize())).toBeLessThan(1e-9);
        expect(rig.distance).toBeCloseTo(80, 9);
        expect(maxStep).toBeLessThan(0.3);
    });

    test('fling decays and stops', () => {
        const { rig } = makeRig();
        const n0 = rig.normal.clone();
        rig.startFling(new Vector3(1, 0, 0), 1);
        for (let i = 0; i < 600; i++)
            rig.update(1 / 60);
        const moved = rig.normal.angleTo(n0);
        expect(moved).toBeGreaterThan(0.1);
        rig.update(1 / 60);
        expect(rig.normal.angleTo(n0)).toBeCloseTo(moved, 9);
    });

    test('update reports a change only after the camera moved', () => {
        const { rig } = makeRig();
        expect(rig.update(0).changed).toBe(true);
        expect(rig.update(0).changed).toBe(false);
        rig.turn(0.1);
        expect(rig.update(0).changed).toBe(true);
    });
});
