import { Matrix4, Quaternion, Vector3 } from 'three';
import { BlueprintData } from '@/blueprint/parser';
import { calcBuildingTrans, findPosForAreas } from '@/blueprint/planet';
import { isBelt } from '@/data/items';

/** 与渲染器一致的星球半径（地面高度）与经线分段 */
export const BELT_R = 200.2;
const PLANET_SEGMENT = 200;
/** 游戏把路径点沿法线抬高 0.15（CargoTraffic.GetBezierArc 末尾） */
export const BELT_LIFT = 0.15;
/** 游戏路径采样间距 */
const STEP = 0.06;
const MAX_SAMPLES = 170;
/** 孤立的一节传送带画成沿自身朝向 ±0.3 m 的短条 */
const LONE_HALF = 0.3;
/** 槽位在末节点前方超过这个距离才需要把路径延伸过去 */
const SLOT_AHEAD = 0.05;
const DEG = Math.PI / 180;

export type BeltTier = 1 | 2 | 3;

/** 游戏模型空间（Y 向上、左手系）里相对建筑根节点的位姿，见 src/data/building.ts */
export interface SlotPose {
    readonly pos: readonly [number, number, number];
    readonly rot: readonly [number, number, number, number];
}
export interface SlotMeta {
    readonly slotPoses: readonly SlotPose[];
}

export interface BeltPoint {
    /** 世界坐标（星球中心为原点），已抬高 BELT_LIFT，即传送带表面中线 */
    pos: Vector3;
    /** 局部 +Y 为前进方向，+Z 为表面法线（含 tilt 滚转），+X 为右侧 */
    rot: Quaternion;
    /** 从本条路径起点量起的弧长（米） */
    t: number;
}

export interface BeltPath {
    tier: BeltTier;
    points: BeltPoint[];
    /** 起点是悬空的端头（没有上游传送带，也没接建筑） */
    startCap: boolean;
    /** 终点是悬空的端头（没有下游传送带，也没接建筑） */
    endCap: boolean;
    /** 路径经过的传送带建筑 index，按流向排列 */
    buildingIndices: number[];
}

interface Node {
    index: number;
    pos: Vector3;
    tilt: number;
    trans: Matrix4;
}

interface Arc {
    points: Vector3[];
    rolls: number[];
    pivot: number;
    /** 第一个点之前、最后一个点之后的参考点（算切线用） */
    before: Vector3;
    after: Vector3;
    /** 末尾是侧向汇入段：最后一点的切线不再看 after */
    hasExt: boolean;
}

const tmp = new Vector3();
const tmp2 = new Vector3();

function bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, s: number) {
    const u = 1 - s;
    return new Vector3()
        .addScaledVector(a, u * u * u)
        .addScaledVector(b, 3 * u * u * s)
        .addScaledVector(c, 3 * u * s * s)
        .addScaledVector(d, s * s * s);
}

/** Unity Vector3.Angle（度） */
function angleDeg(a: Vector3, b: Vector3) {
    const d = Math.sqrt(a.lengthSq() * b.lengthSq());
    if (d < 1e-15)
        return 0;
    return Math.acos(Math.min(1, Math.max(-1, a.dot(b) / d))) / DEG;
}

const lerpClamped = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

function wrapTilt(tilt: number, center: number) {
    const d = tilt - center;
    return d > 180 ? tilt - 360 : d < -180 ? tilt + 360 : tilt;
}

/** 侧向汇入时目标传送带在其 pivot 处的位置（未抬高）、右方向，以及目标路径是否只有一节 */
interface MergeTarget {
    pos: Vector3;
    right: Vector3;
    single: boolean;
}

/**
 * CargoTraffic.GetBezierArc 的移植：以 center 为控制角点，从 (prev+center)/2 到 (next+center)/2 的三次 Bezier，
 * 控制点 C = M*(1-k) + center*k，k 随 prev-center-next 夹角从 0.55192（直角）到 0.66667（直线）。
 * 缺 prev/next 时用另一侧沿地面镜像；侧向汇入时再追加一段通向目标 pivot 的 Bezier（游戏末尾的 5 个重复补位点不输出）。
 */
function bezierArc(center: Vector3, prevIn: Vector3 | null, nextIn: Vector3 | null,
    tiltCenter: number, tiltPrevIn: number, tiltNextIn: number, ext: MergeTarget | null): Arc {
    const hasPrev = prevIn !== null, hasNext = nextIn !== null;
    const hasExt = ext !== null && hasNext;
    let prev = prevIn ?? center.clone();
    let next = nextIn ?? center.clone();
    let tiltPrev = hasPrev ? tiltPrevIn : tiltCenter;
    let tiltNext = hasNext && !hasExt ? tiltNextIn : tiltCenter;
    tiltPrev = wrapTilt(tiltPrev, tiltCenter);
    tiltNext = wrapTilt(tiltNext, tiltCenter);
    const n = center.clone().normalize();
    if (!hasPrev) {
        const v = tmp.subVectors(center, next);
        v.addScaledVector(n, -n.dot(v));
        prev = center.clone().add(v);
    }
    if (!hasNext) {
        const v = tmp.subVectors(center, prev);
        v.addScaledVector(n, -n.dot(v));
        next = center.clone().add(v);
    }
    const toPrev = tmp.subVectors(prev, center);
    const toNext = tmp2.subVectors(next, center);
    const rollPrev = (tiltCenter + tiltPrev) / 2;
    const rollNext = (tiltCenter + tiltNext) / 2;
    const k = lerpClamped(0.55192, 0.66667, (angleDeg(toPrev, toNext) - 90) / 90);
    const m1 = prev.clone().add(center).multiplyScalar(0.5);
    const m2 = next.clone().add(center).multiplyScalar(0.5);
    const c1 = m1.clone().multiplyScalar(1 - k).addScaledVector(center, k);
    const c2 = m2.clone().multiplyScalar(1 - k).addScaledVector(center, k);
    const mid = bezier(m1, c1, c2, m2, 0.5);
    const count = (from: Vector3) => Math.min(MAX_SAMPLES, Math.max(0, Math.round(from.distanceTo(mid) / STEP - 0.3)));
    const n7 = hasPrev ? count(m1) : 4;
    const n8 = hasNext ? count(m2) : 5;

    const points: Vector3[] = [];
    const rolls: number[] = [];
    for (let i = n7; i >= 1; i--) {
        points.push(bezier(m1, c1, c2, m2, 0.5 - i * 0.5 / (n7 + 0.5)));
        const w = 1 - i / (n7 + 0.5);
        rolls.push(tiltCenter * w + rollPrev * (1 - w));
    }
    points.push(mid);
    rolls.push(tiltCenter);
    for (let j = 1; j <= n8; j++) {
        points.push(bezier(m1, c1, c2, m2, 0.5 + j * 0.5 / (n8 + 0.5)));
        const w = 1 - j / (n8 + 0.5);
        rolls.push(tiltCenter * w + rollNext * (1 - w));
    }

    let extAdded = false;
    if (hasExt) {
        const target = ext.pos;
        const d = target.clone().sub(m2);
        const mag = d.length();
        const dir = d.clone().normalize();
        const n17 = Math.min(MAX_SAMPLES, Math.round(mag / STEP));
        if (n17 > 0) {
            const step = mag / n17;
            const n19 = Math.max(1, n17 - 5);
            const a = m2;
            const b = a.clone().addScaledVector(dir, n19 * step);
            const h = a.distanceTo(b) / 3;
            const right = ext.right.clone();
            right.multiplyScalar(tmp.subVectors(a, b).dot(right) >= 0 ? 1 : -1);
            const out = m2.clone().sub(center).normalize();
            const e1 = a.clone().addScaledVector(out, h);
            let e2 = ext.single ? e1.clone().addScaledVector(out, h) : b.clone().addScaledVector(right, h);
            // 有滚转时把第二个控制点往直线上拉，避免汇入段翘出地面
            const up = new Vector3().crossVectors(new Vector3().crossVectors(dir, a), dir).normalize();
            up.applyAxisAngle(dir, -tiltCenter * DEG);
            const w = 1 - Math.abs(up.dot(tmp.copy(a).normalize()));
            const ab = b.clone().sub(a).normalize();
            const proj = ab.dot(tmp.subVectors(e2, a));
            e2 = e2.multiplyScalar(1 - w).addScaledVector(a.clone().addScaledVector(ab, proj), w);
            for (let i = 0; i < n19; i++) {
                points.push(bezier(a, e1, e2, b, (i + 1) / n19));
                rolls.push(rollNext);
            }
            extAdded = true;
        }
    }
    return { points, rolls, pivot: n7, before: m1, after: hasExt ? ext.pos : m2, hasExt: extAdded };
}

/** LookRotation(forward, 法线) * Euler(0,0,roll)，换到本项目右手系：+Y 前、+Z 上、+X 右 */
function frame(forward: Vector3, normal: Vector3, roll: number, fallbackRight: Vector3) {
    const y = forward.clone();
    let x = new Vector3().crossVectors(y, normal);
    if (x.lengthSq() < 1e-12)  // 竖直段：沿用节点自身的右方向
        x = fallbackRight.clone().addScaledVector(y, -fallbackRight.dot(y));
    x.normalize();
    const z = new Vector3().crossVectors(x, y);
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    // Unity 左手系的正角在这里是反向旋转
    if (roll !== 0)
        q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -roll * DEG));
    return q;
}

function rotations(arc: Arc, fallbackRight: Vector3, fallbackForward: Vector3) {
    const { points } = arc;
    const rots: Quaternion[] = [];
    for (let m = 0; m < points.length; m++) {
        const p0 = m === 0 ? arc.before : points[m - 1];
        // 游戏里汇入段最后一点的下一个是补位的重复点（即它自己）
        const p1 = m < points.length - 1 ? points[m + 1] : arc.hasExt ? points[m] : arc.after;
        const dir = new Vector3().subVectors(p1, p0);
        const normal = points[m].clone().normalize();
        if (dir.lengthSq() < 1e-12)
            dir.copy(m > 0 ? new Vector3(0, 1, 0).applyQuaternion(rots[m - 1]) : fallbackForward);
        rots.push(frame(dir.normalize(), normal, arc.rolls[m], fallbackRight));
    }
    return rots;
}

/** 两节以上输入时选出主输入（CargoTraffic.AlterBeltConnections 的 back/left/right 判定） */
function mainInputOf(node: Node, out: Node | null, inputs: Node[]): Node | null {
    if (inputs.length === 0)
        return null;
    if (inputs.length === 1)
        return inputs[0];
    const n = node.pos.clone().normalize();
    if (out) {
        const flat = (p: Vector3) => {
            const v = p.clone().sub(node.pos);
            return v.addScaledVector(n, -0.8 * v.dot(n)).normalize();
        };
        const fwd = flat(out.pos);
        const side = new Vector3().crossVectors(n, fwd);
        if (inputs.length === 2) {
            const [a, b] = inputs.map(i => flat(i.pos));
            const sa = side.dot(a), sb = side.dot(b), fa = fwd.dot(a), fb = fwd.dot(b);
            if (sa * sb <= -0.001 && Math.min(fa, fb) > -0.5)
                return null;  // 左右两侧各一，没有主输入
            return fa < fb ? inputs[0] : inputs[1];
        }
        const ang = inputs.slice(0, 3).map(i => {
            const v = flat(i.pos);
            const r = Math.atan2(side.dot(v), fwd.dot(v));
            return r < 0 ? r + 2 * Math.PI : r;
        });
        const [a0, a1, a2] = ang;
        if (a0 <= a1 && a0 <= a2)
            return a1 > a2 ? inputs[2] : inputs[1];
        if (a1 <= a0 && a1 <= a2)
            return a0 > a2 ? inputs[2] : inputs[0];
        return a0 > a1 ? inputs[1] : inputs[0];
    }
    const dirs = inputs.slice(0, 3).map(i => i.pos.clone().sub(node.pos).normalize());
    if (inputs.length === 2) {
        if (angleDeg(dirs[0], dirs[1]) >= 120)
            return null;
        const d0 = Math.abs(inputs[0].tilt - node.tilt), d1 = Math.abs(inputs[1].tilt - node.tilt);
        return d0 < d1 ? inputs[0] : inputs[1];
    }
    const a01 = angleDeg(dirs[0], dirs[1]), a12 = angleDeg(dirs[1], dirs[2]), a02 = angleDeg(dirs[0], dirs[2]);
    if (a01 >= a02 && a01 >= a12)
        return inputs[2];
    if (a12 >= a02 && a12 >= a01)
        return inputs[0];
    return inputs[1];
}

function defaultTransforms(bp: Pick<BlueprintData, 'areas' | 'buildings'>) {
    const pos = findPosForAreas(bp.areas, PLANET_SEGMENT);
    return bp.buildings.map(b => calcBuildingTrans(BELT_R, pos, b));
}

/**
 * 把蓝图里的传送带按游戏规则连成路径：每节传送带沿主输入→输出链（CargoPath）拼接 GetBezierArc 采样点；
 * 侧向汇入另一条带时追加通向目标 pivot 的一段；接到建筑槽位的一端延伸到该槽位（SlotConfig.slotPoses）。
 * 等级变化处拆成多条路径。transforms 缺省时按渲染器同样的半径与分段计算。
 */
export function buildBeltPaths(
    bp: Pick<BlueprintData, 'areas' | 'buildings'>,
    meta: ReadonlyMap<number, SlotMeta>,
    transforms: Matrix4[][] = defaultTransforms(bp),
): BeltPath[] {
    const slotOf = new Map<number, number>();  // 建筑 index -> 数组下标
    bp.buildings.forEach((b, i) => slotOf.set(b.index, i));
    const buildingAt = (index: number) => {
        const i = slotOf.get(index);
        return i === undefined ? null : bp.buildings[i];
    };

    const nodes = new Map<number, Node>();
    bp.buildings.forEach((b, i) => {
        if (!isBelt(b.itemId) || !transforms[i])
            return;
        const trans = transforms[i][0];
        nodes.set(b.index, { index: b.index, pos: new Vector3().setFromMatrixPosition(trans), tilt: b.tilt[0], trans });
    });

    const outBelt = new Map<number, Node>();
    const inputs = new Map<number, Node[]>();
    for (const node of nodes.values()) {
        const target = nodes.get(buildingAt(node.index)!.outputObjIdx);
        if (!target || target === node)
            continue;
        outBelt.set(node.index, target);
        const list = inputs.get(target.index) ?? [];
        list.push(node);
        inputs.set(target.index, list);
    }
    const mainInput = new Map<number, Node>();
    for (const node of nodes.values()) {
        const main = mainInputOf(node, outBelt.get(node.index) ?? null, inputs.get(node.index) ?? []);
        if (main)
            mainInput.set(node.index, main);
    }
    const succ = (node: Node) => {
        const out = outBelt.get(node.index);
        return out && mainInput.get(out.index) === node ? out : null;
    };

    // 按 CargoPath 分链：从没有主输入的节点出发；剩下的都在环里
    const chains: { nodes: Node[], closed: boolean }[] = [];
    const chainOf = new Map<number, Node[]>();
    const walk = (start: Node) => {
        const list: Node[] = [];
        for (let n: Node | null = start; n && !chainOf.has(n.index); n = succ(n)) {
            list.push(n);
            chainOf.set(n.index, list);
        }
        return list;
    };
    for (const node of nodes.values())
        if (!mainInput.has(node.index))
            chains.push({ nodes: walk(node), closed: false });
    for (const node of nodes.values())
        if (!chainOf.has(node.index))
            chains.push({ nodes: walk(node), closed: true });

    const slotWorld = (buildingIndex: number, slot: number) => {
        const b = buildingAt(buildingIndex);
        if (!b || isBelt(b.itemId))
            return null;
        const pose = meta.get(b.modelIndex)?.slotPoses[slot];
        if (!pose)
            return null;
        // 游戏 (x, y 上, z 前) -> 本项目建筑局部 (x, y 前, z 上)，与 unitBoxTrans 相同
        return new Vector3(pose.pos[0], pose.pos[2], pose.pos[1]).applyMatrix4(transforms[slotOf.get(buildingIndex)!][0]);
    };
    const linksBuilding = (index: number) => {
        const b = buildingAt(index);
        return b !== null && !isBelt(b.itemId);
    };
    const axis = (node: Node, column: 0 | 1) => new Vector3().setFromMatrixColumn(node.trans, column).normalize();

    interface Plan {
        node: Node;
        prev: Vector3 | null;
        next: Vector3 | null;
        tiltPrev: number;
        tiltNext: number;
        trimStart: boolean;
        trimEnd: boolean;
        merge: Node | null;
        connectedIn: boolean;
        connectedOut: boolean;
    }
    const plans = new Map<number, Plan>();
    for (const node of nodes.values()) {
        const b = buildingAt(node.index)!;
        const main = mainInput.get(node.index) ?? null;
        const out = outBelt.get(node.index) ?? null;
        const nextBelt = succ(node) ?? out;
        let prev = main?.pos ?? null;
        let next = nextBelt?.pos ?? null;
        // 接建筑槽位的一端：槽位在节点外侧时放一个虚拟邻点 2*slot-P，使这一端的中点正好落在槽位上
        if (!prev) {
            const slot = slotWorld(b.inputObjIdx, b.inputFromSlot);
            const ref = next ? next.clone().sub(node.pos) : axis(node, 1);
            if (slot && node.pos.clone().sub(slot).dot(ref.normalize()) > SLOT_AHEAD)
                prev = slot.multiplyScalar(2).sub(node.pos);
        }
        if (!next) {
            const slot = slotWorld(b.outputObjIdx, b.outputToSlot);
            const ref = prev ? node.pos.clone().sub(prev) : axis(node, 1);
            if (slot && slot.clone().sub(node.pos).dot(ref.normalize()) > SLOT_AHEAD)
                next = slot.multiplyScalar(2).sub(node.pos);
        }
        if (!prev && !next) {
            const fwd = axis(node, 1);
            prev = node.pos.clone().addScaledVector(fwd, -2 * LONE_HALF);
            next = node.pos.clone().addScaledVector(fwd, 2 * LONE_HALF);
        }
        plans.set(node.index, {
            node, prev, next,
            tiltPrev: main?.tilt ?? node.tilt,
            tiltNext: nextBelt?.tilt ?? node.tilt,
            // 游戏只渲染到悬空端节点的 pivot，镜像出去的半格不画
            trimStart: !prev,
            trimEnd: !next,
            merge: out && !succ(node) ? out : null,
            connectedIn: main !== null || linksBuilding(b.inputObjIdx),
            connectedOut: out !== null || linksBuilding(b.outputObjIdx),
        });
    }
    // 第一遍：每节的基本弧线（侧向汇入需要目标 pivot 的位置与朝向）
    const baseArc = new Map<number, Arc>();
    for (const plan of plans.values())
        baseArc.set(plan.node.index, bezierArc(plan.node.pos, plan.prev, plan.next,
            plan.node.tilt, plan.tiltPrev, plan.tiltNext, null));
    const mergeTarget = (target: Node): MergeTarget => {
        const arc = baseArc.get(target.index)!;
        const rot = rotations(arc, axis(target, 0), axis(target, 1))[arc.pivot];
        return {
            pos: arc.points[arc.pivot],
            right: new Vector3(1, 0, 0).applyQuaternion(rot),
            single: chainOf.get(target.index)!.length <= 1,
        };
    };

    // 第二遍：完整弧线（含汇入段）、朝向、抬高、裁掉悬空端外侧
    const samples = new Map<number, { pos: Vector3, rot: Quaternion }[]>();
    for (const plan of plans.values()) {
        const { node } = plan;
        const arc = plan.merge
            ? bezierArc(node.pos, plan.prev, plan.next, node.tilt, plan.tiltPrev, plan.tiltNext, mergeTarget(plan.merge))
            : baseArc.get(node.index)!;
        const rots = rotations(arc, axis(node, 0), axis(node, 1));
        const from = plan.trimStart ? arc.pivot : 0;
        const to = plan.trimEnd ? arc.pivot + 1 : arc.points.length;
        const list = [];
        for (let i = from; i < to; i++) {
            const p = arc.points[i];
            list.push({ pos: p.clone().addScaledVector(tmp.copy(p).normalize(), BELT_LIFT), rot: rots[i] });
        }
        samples.set(node.index, list);
    }

    const paths: BeltPath[] = [];
    for (const chain of chains) {
        const first = plans.get(chain.nodes[0].index)!;
        const last = plans.get(chain.nodes[chain.nodes.length - 1].index)!;
        const lists = chain.nodes.map(n => samples.get(n.index)!);
        if (chain.closed)  // 首尾闭合
            lists[lists.length - 1] = [...lists[lists.length - 1], { pos: lists[0][0].pos.clone(), rot: lists[0][0].rot.clone() }];
        let group: BeltPath | null = null;
        for (let i = 0; i < chain.nodes.length; i++) {
            const index = chain.nodes[i].index;
            const tier = (buildingAt(index)!.itemId - 2000) as BeltTier;
            if (!group || group.tier !== tier) {
                group = { tier, points: [], startCap: i === 0 && !chain.closed && !first.connectedIn, endCap: false, buildingIndices: [] };
                paths.push(group);
            }
            group.buildingIndices.push(index);
            for (const s of lists[i]) {
                const prev: BeltPoint | undefined = group.points[group.points.length - 1];
                group.points.push({ ...s, t: prev ? prev.t + prev.pos.distanceTo(s.pos) : 0 });
            }
        }
        if (group)
            group.endCap = !chain.closed && !last.connectedOut;
    }
    return paths;
}
