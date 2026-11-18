import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
    connectsToBuilding, cycleSeconds, endFrame, grabberAt, grabberPhase, grabberS, PARKED_PHASE, pointAlong,
    sorterShape, stretchVertex,
} from '@/render/sorterPose';
import { GLTF_TO_LOCAL } from '@/render/core/materials';

/** 两端 + 连接状态 + 动画相位 → 各部件的姿态（与 RealSorters 写实例时的组合相同） */
function poseSorter(a: Matrix4, b: Matrix4, t1: 0 | 1, t2: 0 | 1, phase: number) {
    const shape = sorterShape(a, b, t1, t2);
    const grabber = new Matrix4();
    const loaded = grabberAt(shape, phase, grabber);
    return { ...shape, phase, grabberS: grabberS(phase), grabber, loaded };
}

/** glTF 坐标（y 向上、z 向前）下的末端：位置 + 绕 y 转 yaw 度 */
function frame(x: number, y: number, z: number, yawDeg = 0) {
    return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(0, yawDeg * Math.PI / 180, 0)), new Vector3(1, 1, 1));
}
const A = frame(0, 0, 0);
const B = (z: number) => frame(0, 0, z);
const near = (v: Vector3, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 5);
    expect(v.y).toBeCloseTo(y, 5);
    expect(v.z).toBeCloseTo(z, 5);
};
const posOf = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);

describe('分拣器姿态：两端连接', () => {
    it('连到建筑（对象与槽位都有效且不是传送带）才算 1', () => {
        expect(connectsToBuilding(5, 2, false)).toBe(1);
        expect(connectsToBuilding(-1, -1, false)).toBe(0);
        expect(connectsToBuilding(5, -1, false)).toBe(0);
        expect(connectsToBuilding(-1, 0, false)).toBe(0);
        expect(connectsToBuilding(5, 0, true)).toBe(0);
    });

    it('t1/t2 决定两端的护轨是否显示', () => {
        const both = poseSorter(A, B(4), 1, 1, 0);
        expect([both.aRail, both.bRail]).toEqual([true, true]);
        const onlyA = poseSorter(A, B(4), 1, 0, 0);
        expect([onlyA.aRail, onlyA.bRail]).toEqual([true, false]);
        const onlyB = poseSorter(A, B(4), 0, 1, 0);
        expect([onlyB.aRail, onlyB.bRail]).toEqual([false, true]);
        expect([poseSorter(A, B(4), 0, 0, 0).aRail, poseSorter(A, B(4), 0, 0, 0).bRail]).toEqual([false, false]);
    });

    it('端部件按各自的端点位姿放置', () => {
        const b = frame(3, 0.5, 7, 90);
        const p = poseSorter(A, b, 1, 1, 0);
        expect(p.aFrame.equals(A)).toBe(true);
        expect(p.bFrame.equals(b)).toBe(true);
    });
});

describe('分拣器姿态：顶梁与箭头拉伸', () => {
    it('ATop = A + up + fwd·1.03·t1，BTop = B + up − fwd·1.03·t2', () => {
        const p = poseSorter(A, B(4), 1, 1, 0);
        near(p.aTop, 0, 1, 1.03);
        near(p.bTop, 0, 1, 4 - 1.03);
        const q = poseSorter(A, B(4), 0, 0, 0);
        near(q.aTop, 0, 1, 0);
        near(q.bTop, 0, 1, 4);
    });

    it('默认姿态（B 在 z=2，t1=t2=1）还原模型里烘焙的顶点', () => {
        const p = poseSorter(A, B(2), 1, 1, 0);
        // 箭头：frame 0 顶点在 ATop − 0.5，frame 1 顶点在 BTop + 0.5
        near(stretchVertex(p, 0, new Vector3(-0.4, 1, 0.53)), -0.4, 1, 0.53);
        near(stretchVertex(p, 1, new Vector3(0.4, 1, 1.47)), 0.4, 1, 1.47);
    });

    it('B 拉远：只有 frame 1 的顶点跟着 BTop 移动，frame 0 的不动', () => {
        const p = poseSorter(A, B(6), 1, 1, 0);
        near(stretchVertex(p, 0, new Vector3(-0.4, 1, 0.53)), -0.4, 1, 0.53);
        // BTop 从 0.97 移到 4.97：顶点沿 z 平移 4
        near(stretchVertex(p, 1, new Vector3(0.4, 1, 1.47)), 0.4, 1, 5.47);
    });

    it('t1 = 0 时 ATop 缩回到 A + up，frame 0 顶点后移 1.03', () => {
        const p = poseSorter(A, B(2), 0, 1, 0);
        near(stretchVertex(p, 0, new Vector3(0, 1, 0.53)), 0, 1, -0.5);
    });

    it('顶点按所在端的朝向转动', () => {
        const b = frame(5, 0, 0, 90); // B 转 90°：fwd 指向 +x
        const p = poseSorter(A, b, 1, 1, 0);
        near(p.bTop, 5 - 1.03, 1, 0);
        // B 的 +0.5 前向偏移（顶点 z = BTop.z + 0.5 = 1.47）仍沿 B 的前向（+x）
        near(stretchVertex(p, 1, new Vector3(0, 1, 1.47)), 5 - 1.03 + 0.5, 1, 0);
    });

    it('箭头 v 方向的平铺长度 = |ATop − BTop| + 1 米', () => {
        expect(poseSorter(A, B(6), 1, 1, 0).arrowLength).toBeCloseTo(6 - 2.06 + 1, 5);
        expect(poseSorter(A, B(6), 0, 0, 0).arrowLength).toBeCloseTo(7, 5);
    });
});

describe('分拣器姿态：抓手沿折线运动', () => {
    it('折线是 [A 抬高, ATop, BTop, B 抬高]', () => {
        const p = poseSorter(A, B(6), 1, 1, 0);
        expect(p.polyline).toHaveLength(4);
        near(p.polyline[0], 0, 1, 0);
        near(p.polyline[1], 0, 1, 1.03);
        near(p.polyline[2], 0, 1, 6 - 1.03);
        near(p.polyline[3], 0, 1, 6);
    });

    it('s = 1 − 2|frac(phase) − 0.5|：0 在 A，0.5 在 B，来回', () => {
        expect(grabberS(0)).toBeCloseTo(0, 6);
        expect(grabberS(0.25)).toBeCloseTo(0.5, 6);
        expect(grabberS(0.5)).toBeCloseTo(1, 6);
        expect(grabberS(0.75)).toBeCloseTo(0.5, 6);
        expect(grabberS(1)).toBeCloseTo(0, 6);
        expect(grabberS(2.25)).toBeCloseTo(0.5, 6);
        expect(grabberS(-0.75)).toBeCloseTo(0.5, 6);
    });

    it('按弧长取折线上的点', () => {
        const pts = [new Vector3(0, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, 3), new Vector3(0, 2, 3)];
        near(pointAlong(pts, 0), 0, 0, 0);
        near(pointAlong(pts, 1), 0, 2, 3);
        near(pointAlong(pts, 0.5), 0, 0, 2.5); // 总长 5（1+2+2），一半在 z=2.5
        near(pointAlong(pts, 0.1), 0, 0, 0.5);
        // 零长度折线不出 NaN
        const flat = [new Vector3(1, 2, 3), new Vector3(1, 2, 3), new Vector3(1, 2, 3), new Vector3(1, 2, 3)];
        near(pointAlong(flat, 0.7), 1, 2, 3);
    });

    it('不同相位时抓手在不同位置，朝向跟 A 端', () => {
        const a = frame(0, 0, 0, 90);
        const b = frame(0, 0, 6, 90);
        const at = (phase: number) => poseSorter(a, b, 1, 1, phase);
        // A 转了 90° 后 up 仍是 +y，grabber 矩阵的位置在折线上
        const start = at(0), mid = at(0.25), end = at(0.5);
        near(posOf(start.grabber), 0, 1, 0);
        near(posOf(end.grabber), 0, 1, 6);
        expect(posOf(mid.grabber).z).toBeGreaterThan(0.5);
        expect(posOf(mid.grabber).z).toBeLessThan(5.5);
        // 朝向用 A 端的旋转
        const rotOf = (m: Matrix4) => new Quaternion().setFromRotationMatrix(m);
        expect(rotOf(mid.grabber).angleTo(rotOf(a))).toBeCloseTo(0, 5);
        expect(rotOf(end.grabber).angleTo(rotOf(b))).toBeCloseTo(0, 5);
    });

    it('抓手在 A 端 s=0.5 时正好在折线弧长一半处', () => {
        const p = poseSorter(A, B(6), 1, 1, 0.25);
        expect(p.grabberS).toBeCloseTo(0.5, 6);
        near(posOf(p.grabber), 0, 1, 3);
    });

    it('A→B 途中带着东西（loaded），返回途中是空的', () => {
        expect(poseSorter(A, B(4), 1, 1, 0.1).loaded).toBe(true);
        expect(poseSorter(A, B(4), 1, 1, 0.49).loaded).toBe(true);
        expect(poseSorter(A, B(4), 1, 1, 0.5).loaded).toBe(false);
        expect(poseSorter(A, B(4), 1, 1, 0.9).loaded).toBe(false);
    });

    it('形状与抓手拆开计算时结果一致', () => {
        const shape = sorterShape(A, B(5), 1, 0);
        const full = poseSorter(A, B(5), 1, 0, 0.3);
        near(shape.bTop, full.bTop.x, full.bTop.y, full.bTop.z);
        expect(shape.polyline.map(v => v.toArray())).toEqual(full.polyline.map(v => v.toArray()));
    });
});

describe('分拣器姿态：动画速度', () => {
    it('一个往返的时长 = 2·inserterSTT / 10000 tick ÷ 60 tick/s', () => {
        expect(cycleSeconds(200000)).toBeCloseTo(40 / 60, 6);
        expect(cycleSeconds(100000)).toBeCloseTo(20 / 60, 6);
        expect(cycleSeconds(50000)).toBeCloseTo(10 / 60, 6);
        expect(cycleSeconds(30000)).toBeCloseTo(6 / 60, 6);
    });

    it('相位随时间前进，速度越快一圈越短', () => {
        const slow = cycleSeconds(200000), fast = cycleSeconds(50000);
        expect(grabberPhase(slow / 4, slow, 0)).toBeCloseTo(0.25, 6);
        expect(grabberPhase(slow / 4, fast, 0)).toBeCloseTo(0, 6);
        expect(grabberPhase(1.0, slow, 0.3)).toBeGreaterThanOrEqual(0);
        expect(grabberPhase(1.0, slow, 0.3)).toBeLessThan(1);
    });

    it('停止动画时抓手停在固定位置（带货、折线一半处）', () => {
        expect(grabberS(PARKED_PHASE)).toBeCloseTo(0.5, 6);
        expect(poseSorter(A, B(4), 1, 1, PARKED_PHASE).loaded).toBe(true);
    });
});

describe('分拣器姿态：朝向与蓝图一致', () => {
    // 与 calcBuildingTrans 一致的末端：本地 z 朝上、绕 z 转 −yaw
    const surface = (x: number, y: number, z: number, yawDeg: number) => new Matrix4().compose(
        new Vector3(x, y, z),
        new Quaternion().setFromEuler(new Euler(0, 0, -yawDeg / 180 * Math.PI)),
        new Vector3(1, 1, 1),
    );

    it('pitch=tilt=0 时末端朝向与建筑变换完全相同（只多一个 glTF→本地 的轴映射）', () => {
        const t = surface(10, 20, 3, 30);
        const f = endFrame(t, 30, 0, 0);
        expect(f.equals(t.clone().multiply(GLTF_TO_LOCAL))).toBe(true);
        // 模型前向 +z 映射到本地 +y（yaw=0 时朝北），再随 yaw 转
        const fwd = new Vector3(0, 0, 1).transformDirection(f);
        const expected = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, 0, -30 / 180 * Math.PI)));
        near(fwd, expected.x, expected.y, expected.z);
        // 模型向上 +y 映射到本地 +z
        near(new Vector3(0, 1, 0).transformDirection(f), 0, 0, 1);
    });

    it('yaw 与建筑同向（Unity 顺时针 = 本地绕 z 负向）', () => {
        const f = endFrame(surface(0, 0, 0, 90), 90, 0, 0);
        // yaw 90° 后前向从北转向东 (+x)
        near(new Vector3(0, 0, 1).transformDirection(f), 1, 0, 0);
    });

    it('pitch 抬头（Unity 绕 x，pitch>0 前向朝下）：前向的向上分量符号与游戏一致', () => {
        // Unity：Quaternion.Euler(90,0,0) 把 +z 转到 −y（朝下）
        const f = endFrame(surface(0, 0, 0, 0), 0, 0, 90);
        near(new Vector3(0, 0, 1).transformDirection(f), 0, 0, -1);
    });

    it('tilt 绕前向滚转，不改变前向', () => {
        const f = endFrame(surface(0, 0, 0, 0), 0, 45, 0);
        near(new Vector3(0, 0, 1).transformDirection(f), 0, 1, 0);
        // 向上被滚到侧面：Unity 绕 z 转 45°（+y → −x·sin）→ 本地 x 分量非零
        expect(Math.abs(new Vector3(0, 1, 0).transformDirection(f).x)).toBeGreaterThan(0.5);
    });
});
