import { readFileSync } from "fs";
import { join } from "path";
import { PerspectiveCamera, Vector3 } from "three";
import { BlueprintBuilding, BlueprintData, fromStr } from "@/blueprint/parser";
import { calcBuildingTrans, findPosForAreas } from "@/blueprint/planet";
import { blueprintBoundsPoints, frameBounds, FramingOptions } from "@/render/core/framing";

const R = 200.2;

function fixture(name: string) {
    return fromStr(readFileSync(join(__dirname, '..', 'blueprint', 'fixtures', name), 'utf8').trim());
}

function boundsOf(data: BlueprintData) {
    const pos = findPosForAreas(data.areas, 200);
    const transforms = data.buildings.map(b => calcBuildingTrans(R, pos, b));
    return blueprintBoundsPoints(data.buildings, transforms);
}

/** 把蓝图复制成 cols×rows 的阵列，得到一个占地很大的蓝图（越过赤道/靠近高纬度） */
function tiled(data: BlueprintData, cols: number, rows: number, step: number, y0 = 0): BlueprintData {
    const buildings: BlueprintBuilding[] = [];
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            for (const b of data.buildings) {
                const off = (o: BlueprintBuilding['localOffset'][0]) => ({ x: o.x + i * step, y: o.y + j * step + y0, z: o.z });
                buildings.push({ ...b, index: buildings.length, localOffset: [off(b.localOffset[0]), off(b.localOffset[1])] });
            }
        }
    }
    return { ...data, buildings };
}

/** 用真实的透视相机投影包围点，返回 NDC 的最大绝对坐标；任何点在相机后面都视为没框住 */
function coverage(points: Vector3[], opts: FramingOptions) {
    const f = frameBounds(points, opts);
    const camera = new PerspectiveCamera(opts.fov, opts.aspect, 0.5, 3000);
    camera.position.copy(f.position);
    camera.up.copy(f.up);
    camera.lookAt(f.target);
    camera.updateMatrixWorld();
    let max = 0;
    const v = new Vector3();
    for (const p of points) {
        v.copy(p).applyMatrix4(camera.matrixWorldInverse);
        if (v.z >= 0)
            return { f, max: Infinity };
        v.applyMatrix4(camera.projectionMatrix);
        max = Math.max(max, Math.abs(v.x), Math.abs(v.y));
    }
    return { f, max };
}

const views: [string, Partial<FramingOptions>][] = [
    ['desktop oblique', { aspect: 16 / 9, tilt: 40 / 180 * Math.PI }],
    ['desktop top', { aspect: 16 / 9, tilt: 0 }],
    ['mobile portrait oblique', { aspect: 0.55, tilt: 40 / 180 * Math.PI }],
];

describe('frameBounds', () => {
    for (const name of ['v0.10.35.txt', 'v0.10.32.txt']) {
        const points = boundsOf(fixture(name));
        for (const [view, o] of views) {
            test(`${name} ${view}: every building is inside the view and fills it`, () => {
                const opts: FramingOptions = { R, fov: 50, aspect: 1, minDistance: 0, maxDistance: 3 * R, ...o };
                const { f, max } = coverage(points, opts);
                expect(max).toBeLessThanOrEqual(1);
                // 不能靠拉远来"框住"：最外侧的建筑应在画面一半以外
                expect(max).toBeGreaterThan(0.5);
                // 目标点在星球表面，相机在地面以上
                expect(f.target.length()).toBeCloseTo(R, 3);
                expect(f.position.length()).toBeGreaterThan(R);
            });
        }
    }

    test('the default fixed camera before framing does not show the fixture', () => {
        // 旧渲染器把相机固定在 (0, 0, 2R) 看向球心：蓝图在球的另一侧/画面外
        const points = boundsOf(fixture('v0.10.35.txt'));
        const camera = new PerspectiveCamera(50, 16 / 9, 0.5, 3000);
        camera.position.set(0, 0, 2 * R);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const v = new Vector3();
        const toCamera = new Vector3();
        const inView = points.filter((p: Vector3) => {
            v.copy(p).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
            // 在视锥内，并且位于面向相机的半球（不被星球挡住）
            return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && p.dot(toCamera.subVectors(camera.position, p)) > 0;
        });
        expect(inView.length).toBeLessThan(points.length);
    });

    test('a large tiled blueprint near a tropic is covered', () => {
        const points = boundsOf(tiled(fixture('v0.10.35.txt'), 8, 6, 24, 40));
        for (const [, o] of views) {
            const { max } = coverage(points, { R, fov: 50, aspect: 1, minDistance: 0, maxDistance: 3 * R, ...o });
            expect(max).toBeLessThanOrEqual(1);
            expect(max).toBeGreaterThan(0.5);
        }
    });

    test('distance respects the controls limits', () => {
        const points = boundsOf(fixture('v0.10.35.txt'));
        const { f } = coverage(points, { R, fov: 50, aspect: 16 / 9, tilt: 0, minDistance: 0.5 * R, maxDistance: 3 * R });
        expect(f.distance).toBeCloseTo(0.5 * R, 6);
    });

    test('screen up points to planet north so the layout is not rotated or mirrored', () => {
        const points = boundsOf(fixture('v0.10.35.txt'));
        const { f } = coverage(points, { R, fov: 50, aspect: 16 / 9, tilt: 0, minDistance: 0, maxDistance: 3 * R });
        // 北（+y 纬度增加方向）在屏幕上方，东（经度增加方向）在屏幕右侧
        const camera = new PerspectiveCamera(50, 16 / 9, 0.5, 3000);
        camera.position.copy(f.position);
        camera.up.copy(f.up);
        camera.lookAt(f.target);
        camera.updateMatrixWorld();
        const project = (p: Vector3) => p.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
        const c = project(f.target);
        const north = project(f.target.clone().addScaledVector(f.north, 5));
        const east = project(f.target.clone().addScaledVector(f.east, 5));
        expect(north.y).toBeGreaterThan(c.y);
        expect(east.x).toBeGreaterThan(c.x);
    });
});
