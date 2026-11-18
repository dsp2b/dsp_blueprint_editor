import { Vector3 } from 'three';
import { BlueprintArea, BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import { calcBuildingTrans, findPosForAreas } from '@/blueprint/planet';
import { buildBeltPaths, BeltPath, BELT_LIFT, BELT_R } from '@/render/beltPath';

const AREAS: BlueprintArea[] = [{
    index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 200,
    anchorLocalOffset: { x: 0, y: 0 }, size: { x: 1, y: 1 },
}];

const STATION_MODEL = 900;
/** 测试用的槽位：游戏模型空间（Y 向上、Z 向前），与物流站的 1 号、7 号槽位同形 */
const META = new Map([[STATION_MODEL, {
    slotPoses: [
        { pos: [0, -0.01, 2.7], rot: [0, 0, 0, 1] },
        { pos: [0, -0.01, -2.7], rot: [0, -1, 0, 0] },
    ] as { pos: [number, number, number], rot: [number, number, number, number] }[],
}]]);

function building(index: number, itemId: number, modelIndex: number, x: number, y: number, z = 0, extra: Partial<BlueprintBuilding> = {}): BlueprintBuilding {
    return {
        index, areaIndex: 0,
        localOffset: [{ x, y, z }, { x, y, z }],
        yaw: [0, 0], tilt: [0, 0], pitch: [0, 0],
        itemId, modelIndex,
        outputObjIdx: -1, inputObjIdx: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0,
        recipeId: 0, filterId: 0, parameters: null, content: null,
        ...extra,
    };
}
const belt = (index: number, x: number, y: number, z: number, out: number, extra: Partial<BlueprintBuilding> = {}) =>
    building(index, 2001, 35, x, y, z, { outputObjIdx: out, ...extra });

function blueprint(buildings: BlueprintBuilding[]) {
    return { areas: AREAS, buildings } as unknown as BlueprintData;
}

const positioned = findPosForAreas(AREAS, 200);
/** 建筑根节点（地面）的世界坐标与该处的"上" */
function rootPos(b: BlueprintBuilding) {
    return new Vector3().setFromMatrixPosition(calcBuildingTrans(BELT_R, positioned, b)[0]);
}
const lifted = (p: Vector3) => p.clone().addScaledVector(p.clone().normalize(), BELT_LIFT);
const forwardOf = (p: BeltPath['points'][number]) => new Vector3(0, 1, 0).applyQuaternion(p.rot);
const upOf = (p: BeltPath['points'][number]) => new Vector3(0, 0, 1).applyQuaternion(p.rot);
const rightOf = (p: BeltPath['points'][number]) => new Vector3(1, 0, 0).applyQuaternion(p.rot);
const pathOf = (paths: BeltPath[], index: number) => paths.find(p => p.buildingIndices.includes(index))!;

/** 赤道附近一格的长度（东向） */
const b0 = building(0, 2001, 35, 0, 0);
const GRID = rootPos(building(0, 2001, 35, 1, 0)).distanceTo(rootPos(b0));

function expectSpacing(path: BeltPath) {
    for (let i = 1; i < path.points.length; i++) {
        const d = path.points[i].pos.distanceTo(path.points[i - 1].pos);
        expect(d).toBeGreaterThan(0.02);
        expect(d).toBeLessThan(0.1);
        expect(path.points[i].t).toBeCloseTo(path.points[i - 1].t + d, 5);
    }
    expect(path.points[0].t).toBe(0);
}

describe('buildBeltPaths', () => {
    test('straight chain: one path, uniform ~0.06 spacing, open ends stop at the end nodes with caps', () => {
        const bs = [belt(0, 0, 0, 0, 1), belt(1, 1, 0, 0, 2), belt(2, 2, 0, 0, -1)];
        const paths = buildBeltPaths(blueprint(bs), META);
        expect(paths).toHaveLength(1);
        const [p] = paths;
        expect(p.buildingIndices).toEqual([0, 1, 2]);
        expect(p.tier).toBe(1);
        expect(p.startCap).toBe(true);
        expect(p.endCap).toBe(true);
        expectSpacing(p);
        const east = rootPos(bs[1]).sub(rootPos(bs[0])).normalize();
        // 游戏只渲染到首尾节点的 pivot（镜像出去的半格不画），端盖放在那里
        expect(p.points[0].pos.distanceTo(lifted(rootPos(bs[0])))).toBeLessThan(0.01);
        expect(p.points[p.points.length - 1].pos.distanceTo(lifted(rootPos(bs[2])))).toBeLessThan(0.01);
        // 直线段 k = 2/3：采样等距
        const gaps = p.points.slice(1).map((q, i) => q.pos.distanceTo(p.points[i].pos));
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.02);
        for (const q of p.points) {
            expect(forwardOf(q).dot(east)).toBeGreaterThan(0.999);
            expect(upOf(q).dot(q.pos.clone().normalize())).toBeGreaterThan(0.999);
            expect(q.pos.length()).toBeCloseTo(BELT_R + BELT_LIFT, 1);
        }
        // 右手系：东行传送带的右侧朝南
        const north = rootPos(building(0, 2001, 35, 0, 1)).sub(rootPos(b0)).normalize();
        expect(rightOf(p.points[10]).dot(north)).toBeLessThan(-0.999);
    });

    test('90° turn follows the GetBezierArc quarter circle (k = 0.55192)', () => {
        const bs = [belt(0, 0, 0, 0, 1), belt(1, 1, 0, 0, 2), belt(2, 1, 1, 0, -1)];
        const [p] = buildBeltPaths(blueprint(bs), META);
        expect(p.buildingIndices).toEqual([0, 1, 2]);
        expectSpacing(p);
        const c0 = lifted(rootPos(bs[0])), c1 = lifted(rootPos(bs[1])), c2 = lifted(rootPos(bs[2]));
        // 圆心：两条中线的交点 = c0 与 c2 的中点
        const center = c0.clone().add(c2).multiplyScalar(0.5);
        const radius = c1.distanceTo(c0) / 2;
        const inTurn = p.points.filter(q => q.pos.distanceTo(c1) < radius * 0.999);
        expect(inTurn.length).toBeGreaterThan(10);
        for (const q of inTurn)
            expect(Math.abs(q.pos.distanceTo(center) - radius) / radius).toBeLessThan(0.004);
        const east = c1.clone().sub(c0).normalize(), north = c2.clone().sub(c1).normalize();
        expect(forwardOf(p.points[0]).dot(east)).toBeGreaterThan(0.99);
        expect(forwardOf(p.points[p.points.length - 1]).dot(north)).toBeGreaterThan(0.99);
        // 转角处朝向在东与北之间平滑过渡
        const mid = inTurn[Math.floor(inTurn.length / 2)];
        expect(forwardOf(mid).dot(east.clone().add(north).normalize())).toBeGreaterThan(0.99);
    });

    test('height change follows the endpoint heights and the ends stay level', () => {
        const bs = [belt(0, 0, 0, 0, 1), belt(1, 1, 0, 0, 2), belt(2, 2, 0, 1, 3), belt(3, 3, 0, 1, -1)];
        const [p] = buildBeltPaths(blueprint(bs), META);
        expectSpacing(p);
        const heights = p.points.map(q => q.pos.length());
        for (let i = 1; i < heights.length; i++)
            expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1] - 2e-3); // 弦长 1.26 m 的球面下垂约 1 mm
        expect(heights[0]).toBeCloseTo(BELT_R + BELT_LIFT, 2);
        expect(heights[heights.length - 1]).toBeCloseTo(BELT_R + 4 / 3 + BELT_LIFT, 2);
        const climbing = p.points.find(q => Math.abs(q.pos.length() - (BELT_R + 2 / 3 + BELT_LIFT)) < 0.05)!;
        expect(forwardOf(climbing).dot(climbing.pos.clone().normalize())).toBeGreaterThan(0.3);
        expect(upOf(climbing).dot(forwardOf(climbing))).toBeCloseTo(0, 5);
    });

    test('chain ends: no input/output gets caps; ends joined to a building slot do not', () => {
        const station = building(0, 2103, STATION_MODEL, 0, 0);
        // 流入链：从北边往南流入 0 号槽（北侧）
        const into = [belt(1, 0, 4, 0, 2), belt(2, 0, 3, 0, 3), belt(3, 0, 2, 0, 0, { outputToSlot: 0 })];
        // 流出链：从 1 号槽（南侧）往南流出，末端悬空
        const out = [
            belt(4, 0, -2, 0, 5, { inputObjIdx: 0, inputFromSlot: 1 }),
            belt(5, 0, -3, 0, 6), belt(6, 0, -4, 0, -1),
        ];
        const paths = buildBeltPaths(blueprint([station, ...into, ...out]), META);
        expect(paths).toHaveLength(2);
        const a = pathOf(paths, 1), b = pathOf(paths, 4);
        expect(a.buildingIndices).toEqual([1, 2, 3]);
        expect([a.startCap, a.endCap]).toEqual([true, false]);
        expect(b.buildingIndices).toEqual([4, 5, 6]);
        expect([b.startCap, b.endCap]).toEqual([false, true]);
        expectSpacing(a);
        expectSpacing(b);
    });

    test('slot join: the path extends to the building slot pose (Unity Y-up mapped, building yaw applied)', () => {
        const station = building(0, 2103, STATION_MODEL, 0, 0, 0, { yaw: [90, 90] });
        // yaw 90：0 号槽（模型前方 2.7 m）转到东侧；末节点在 3 格（≈3.77 m）处，离槽位还有一段
        const bs = [station,
            belt(1, 5, 0, 0, 2), belt(2, 4, 0, 0, 3), belt(3, 3, 0, 0, 0, { outputToSlot: 0 }),
            belt(4, -3, 0, 0, 5, { inputObjIdx: 0, inputFromSlot: 1 }), belt(5, -4, 0, 0, -1),
        ];
        const paths = buildBeltPaths(blueprint(bs), META);
        const sc = rootPos(station);
        const up = sc.clone().normalize();
        const east = rootPos(building(0, 2001, 35, 1, 0)).sub(sc).normalize();
        const slot0 = sc.clone().addScaledVector(east, 2.7).addScaledVector(up, -0.01 + BELT_LIFT);
        const slot1 = sc.clone().addScaledVector(east, -2.7).addScaledVector(up, -0.01 + BELT_LIFT);
        const a = pathOf(paths, 1), b = pathOf(paths, 4);
        expect(a.buildingIndices).toEqual([1, 2, 3]);
        expect(b.buildingIndices).toEqual([4, 5]);
        expect(a.points[a.points.length - 1].pos.distanceTo(slot0)).toBeLessThan(0.04);
        expect(b.points[0].pos.distanceTo(slot1)).toBeLessThan(0.04);
        expect([a.endCap, b.startCap]).toEqual([false, false]);
        expectSpacing(a);
        expectSpacing(b);
        // 进站方向朝西（指向站心），出站方向也朝西（离开站心）
        expect(forwardOf(a.points[a.points.length - 1]).dot(east)).toBeLessThan(-0.99);
        expect(forwardOf(b.points[0]).dot(east)).toBeLessThan(-0.99);
    });

    test('slot join: a node already past the slot keeps the game end at the node, through the slot', () => {
        const station = building(0, 2103, STATION_MODEL, 0, 0);
        // 0 号槽在北侧 2.7 m，末节点在 2 格（≈2.52 m）处，已越过槽位
        const bs = [station, belt(1, 0, 4, 0, 2), belt(2, 0, 3, 0, 3), belt(3, 0, 2, 0, 0, { outputToSlot: 0 })];
        const [p] = buildBeltPaths(blueprint(bs), META);
        const sc = rootPos(station);
        const north = rootPos(building(0, 2001, 35, 0, 1)).sub(sc).normalize();
        const slot0 = sc.clone().addScaledVector(north, 2.7).addScaledVector(sc.clone().normalize(), -0.01 + BELT_LIFT);
        expect(p.points[p.points.length - 1].pos.distanceTo(lifted(rootPos(bs[3])))).toBeLessThan(0.01);
        expect(Math.min(...p.points.map(q => q.pos.distanceTo(slot0)))).toBeLessThan(0.04);
        expect(p.endCap).toBe(false);
    });

    test('a lone belt is a short capped stub along its yaw', () => {
        const [p] = buildBeltPaths(blueprint([belt(0, 0, 0, 0, -1, { yaw: [90, 90] })]), META);
        const east = rootPos(building(0, 2001, 35, 1, 0)).sub(rootPos(b0)).normalize();
        expect([p.startCap, p.endCap]).toEqual([true, true]);
        expect(p.points.length).toBeGreaterThan(3);
        expectSpacing(p);
        expect(forwardOf(p.points[0]).dot(east)).toBeGreaterThan(0.999);
        const c = lifted(rootPos(b0));
        expect(p.points[0].pos.clone().sub(c).dot(east)).toBeLessThan(-0.1);
        expect(p.points[p.points.length - 1].pos.clone().sub(c).dot(east)).toBeGreaterThan(0.1);
    });

    test('side merge: the feeder ends on the main belt centre line pulled back, the main line is unchanged', () => {
        // 主线 0→1→2→3 向东；支线 4→5 从南边向北汇入 1 的侧面
        const bs = [
            belt(0, 0, 0, 0, 1), belt(1, 1, 0, 0, 2), belt(2, 2, 0, 0, 3), belt(3, 3, 0, 0, -1),
            belt(4, 1, -2, 0, 5), belt(5, 1, -1, 0, 1),
        ];
        const paths = buildBeltPaths(blueprint(bs), META);
        expect(paths).toHaveLength(2);
        const main = pathOf(paths, 0), side = pathOf(paths, 4);
        expect(main.buildingIndices).toEqual([0, 1, 2, 3]);
        expect(side.buildingIndices).toEqual([4, 5]);
        expect([side.startCap, side.endCap]).toEqual([true, false]);
        expectSpacing(main);
        expectSpacing(side);
        const target = lifted(rootPos(bs[1]));
        const last = side.points[side.points.length - 1];
        // 支线一直延伸到主线中线前 5 个采样（≈0.3 m）处
        expect(last.pos.distanceTo(target)).toBeGreaterThan(0.2);
        expect(last.pos.distanceTo(target)).toBeLessThan(0.4);
        const north = target.clone().sub(lifted(rootPos(bs[5]))).normalize();
        expect(forwardOf(last).dot(north)).toBeGreaterThan(0.9);
        // 支线越过自身末节点中点（半格）之后还在往前
        const halfway = lifted(rootPos(bs[5])).addScaledVector(north, GRID / 2);
        expect(last.pos.clone().sub(halfway).dot(north)).toBeGreaterThan(0.2);
    });

    test('back input wins over a side input; tier changes split the path', () => {
        const bs = [
            belt(0, 0, 0, 0, 1), building(1, 2002, 36, 1, 0, 0, { outputObjIdx: 2 }), building(2, 2002, 36, 2, 0, 0),
            belt(3, 1, 1, 0, 1),
        ];
        const paths = buildBeltPaths(blueprint(bs), META);
        expect(paths.map(p => [p.tier, p.buildingIndices])).toEqual(expect.arrayContaining([
            [1, [0]], [2, [1, 2]], [1, [3]],
        ]));
        expect(paths).toHaveLength(3);
        const first = pathOf(paths, 0), second = pathOf(paths, 1);
        expect([first.startCap, first.endCap, second.startCap, second.endCap]).toEqual([true, false, false, true]);
        // 分段处首尾相接
        expect(first.points[first.points.length - 1].pos.distanceTo(second.points[0].pos)).toBeLessThan(0.1);
    });

    test('a closed loop becomes one path without caps', () => {
        const bs = [belt(0, 0, 0, 0, 1), belt(1, 1, 0, 0, 2), belt(2, 1, 1, 0, 3), belt(3, 0, 1, 0, 0)];
        const paths = buildBeltPaths(blueprint(bs), META);
        expect(paths).toHaveLength(1);
        const [p] = paths;
        expect([...p.buildingIndices].sort()).toEqual([0, 1, 2, 3]);
        expect([p.startCap, p.endCap]).toEqual([false, false]);
        expect(p.points[0].pos.distanceTo(p.points[p.points.length - 1].pos)).toBeLessThan(0.1);
    });
});
