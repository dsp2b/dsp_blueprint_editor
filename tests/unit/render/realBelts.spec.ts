import { readFileSync } from 'fs';
import { join } from 'path';
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { BlueprintArea, BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import { calcBuildingTrans, findPosForAreas } from '@/blueprint/planet';
import { BELT_R, BeltPath, buildBeltPaths } from '@/render/beltPath';
import {
    beltNodes, beltRings, capPlacements, METERS_PER_TEX_REPEAT, sectionOf, sweep,
} from '@/render/real/belts';
import { MergedParts } from '@/render/core/mergedParts';
import { beltMetersPerSecond, cargoOffsets, cargoPlateGeometry, sampleRings } from '@/render/real/cargo';

// ───────── 读真实的 belt-mk1.glb（只取 segment 网格的访问器） ─────────

function readGlbMesh(file: string, meshName: string) {
    const buf = readFileSync(file);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    const bin = buf.subarray(20 + jsonLen + 8);
    const accessor = (i: number) => {
        const a = json.accessors[i];
        const view = json.bufferViews[a.bufferView];
        const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[a.type];
        const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
        const out: number[] = [];
        for (let k = 0; k < a.count * n; k++) {
            if (a.componentType === 5126)
                out.push(bin.readFloatLE(offset + k * 4));
            else if (a.componentType === 5123)
                out.push(bin.readUInt16LE(offset + k * 2));
            else
                out.push(bin.readUInt32LE(offset + k * 4));
        }
        return { n, data: out };
    };
    const prim = json.meshes.find((m: { name: string }) => m.name === meshName).primitives[0];
    const g = new BufferGeometry();
    const names: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1' };
    for (const [attr, idx] of Object.entries(prim.attributes) as [string, number][]) {
        const { n, data } = accessor(idx);
        g.setAttribute(names[attr], new BufferAttribute(new Float32Array(data), n));
    }
    g.setIndex(accessor(prim.indices).data);
    return g;
}

const SEGMENT = readGlbMesh(join(__dirname, '..', '..', '..', 'public', 'models', 'belt', 'belt-mk1.glb'), 'belt-segment-1m');

// ───────── 小蓝图 ─────────

const AREAS: BlueprintArea[] = [{
    index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 200,
    anchorLocalOffset: { x: 0, y: 0 }, size: { x: 1, y: 1 },
}];
function belt(index: number, x: number, y: number, out: number, z = 0): BlueprintBuilding {
    return {
        index, areaIndex: 0,
        localOffset: [{ x, y, z }, { x, y, z }],
        yaw: [0, 0], tilt: [0, 0], pitch: [0, 0],
        itemId: 2001, modelIndex: 35,
        outputObjIdx: out, inputObjIdx: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0,
        recipeId: 0, filterId: 0, parameters: null, content: null,
    };
}
function pathsOf(buildings: BlueprintBuilding[]) {
    const bp = { areas: AREAS, buildings } as unknown as BlueprintData;
    const pos = findPosForAreas(AREAS, 200);
    const transforms = buildings.map(b => calcBuildingTrans(BELT_R, pos, b));
    return { paths: buildBeltPaths(bp, new Map(), transforms), transforms };
}
const straight3 = () => pathsOf([belt(0, 0, 0, 1), belt(1, 1, 0, 2), belt(2, 2, 0, -1)]);

const rightOf = (rot: Quaternion) => new Vector3(1, 0, 0).applyQuaternion(rot);
const upOf = (rot: Quaternion) => new Vector3(0, 0, 1).applyQuaternion(rot);
const fwdOf = (rot: Quaternion) => new Vector3(0, 1, 0).applyQuaternion(rot);

describe('belt cross-section', () => {
    test('the game segment yields one ring of 8 vertices (top ±0.4, bottom ±0.452 at −0.15) and 8 triangles', () => {
        const s = sectionOf(SEGMENT);
        expect(s.verts).toHaveLength(8);
        expect(s.tris).toHaveLength(24);
        const xs = (y: number) => s.verts.filter(v => Math.abs(v.y - y) < 1e-4).map(v => Math.round(Math.abs(v.x) * 1000));
        expect(new Set(xs(0))).toEqual(new Set([400]));
        expect(new Set(xs(-0.15))).toEqual(new Set([452]));
        // 每个三角形都跨前后两圈
        for (let k = 0; k < s.tris.length; k += 3) {
            const tri = s.tris.slice(k, k + 3);
            expect(tri.some(v => v < 8)).toBe(true);
            expect(tri.some(v => v >= 8)).toBe(true);
        }
    });
});

describe('belt sweep', () => {
    test('follows the path: top edges at ±0.4 m beside each point, bottom 0.15 m below; u = arc length / 1.02', () => {
        const { paths, transforms } = straight3();
        const [path] = paths;
        const rings = beltRings(path, beltNodes(path, transforms));
        const out = new MergedParts();
        sweep(rings, sectionOf(SEGMENT), out);
        expect(out.vertexCount).toBe(rings.length * 8);
        const vert = (i: number) => new Vector3(out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2]);
        rings.forEach((r, j) => {
            const offsets = Array.from({ length: 8 }, (_, k) => vert(j * 8 + k).sub(r.pos));
            const tops = offsets.filter(o => Math.abs(o.dot(upOf(r.rot))) < 1e-4);
            const bottoms = offsets.filter(o => Math.abs(o.dot(upOf(r.rot)) + 0.15) < 1e-4);
            expect(tops.map(o => Math.round(Math.abs(o.dot(rightOf(r.rot))) * 1000))).toEqual([400, 400, 400, 400]);
            expect(bottoms).toHaveLength(4);
            for (let k = 0; k < 8; k++)
                expect(out.uv0[(j * 8 + k) * 2]).toBeCloseTo(r.t / METERS_PER_TEX_REPEAT, 6);
        });
    });

    test('faces point outwards: triangle winding agrees with the vertex normals (no mirror)', () => {
        const { paths, transforms } = pathsOf([belt(0, 0, 0, 1), belt(1, 1, 0, 2), belt(2, 1, 1, -1)]);
        const [path] = paths;
        const out = new MergedParts();
        sweep(beltRings(path, beltNodes(path, transforms)), sectionOf(SEGMENT), out);
        const v = (i: number) => new Vector3(out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2]);
        const n = (i: number) => new Vector3(out.normals[i * 3], out.normals[i * 3 + 1], out.normals[i * 3 + 2]);
        let checked = 0;
        for (let k = 0; k < out.indices.length; k += 3) {
            const [a, b, c] = out.indices.slice(k, k + 3);
            const face = new Vector3().crossVectors(v(b).sub(v(a)), v(c).sub(v(a)));
            if (face.lengthSq() < 1e-12)
                continue;
            expect(face.normalize().dot(n(a))).toBeGreaterThan(0.5);
            checked++;
        }
        expect(checked).toBeGreaterThan(100);
    });

    test('one pair of edge lights per belt building: TEXCOORD_1.x passes 0.5 once per building, at its node', () => {
        const { paths, transforms } = straight3();
        const [path] = paths;
        const nodes = beltNodes(path, transforms);
        const rings = beltRings(path, nodes);
        path.buildingIndices.forEach((index, k) => {
            const own = rings.filter(r => r.building === index);
            expect(own.length).toBeGreaterThan(3);
            // e 沿流向单调不减，所以 0.5（灯）只出现在一处：节点上（悬空端节点处 e 从 0.5 开始或结束）
            own.forEach((r, i) => i > 0 && expect(r.e).toBeGreaterThanOrEqual(own[i - 1].e));
            const light = own.reduce((a, r) => Math.abs(r.e - 0.5) < Math.abs(a.e - 0.5) ? r : a);
            expect(light.e).toBeCloseTo(0.5, 1);
            expect(light.pos.distanceTo(nodes[k])).toBeLessThan(0.1);
            expect(Math.min(...own.map(r => r.e))).toBeGreaterThanOrEqual(0);
            expect(Math.max(...own.map(r => r.e))).toBeLessThanOrEqual(1);
        });
        // 交界处重复一圈：前一节 e=1，后一节从 e=0 重新开始，中间不连三角形
        const cuts = rings.filter((r, i) => i > 0 && r.cut);
        expect(cuts).toHaveLength(2);
        for (const c of cuts) {
            const before = rings[rings.indexOf(c) - 1];
            expect(before.pos).toBe(c.pos);
            expect(before.e).toBeCloseTo(1, 6);
            expect(c.e).toBeCloseTo(0, 6);
        }
    });

    test('a height change is swept along the sloped path', () => {
        const { paths, transforms } = pathsOf([belt(0, 0, 0, 1, 0), belt(1, 1, 0, 2, 0.5), belt(2, 2, 0, -1, 1)]);
        const [path] = paths;
        const rings = beltRings(path, beltNodes(path, transforms));
        const height = (p: Vector3) => p.length();
        expect(height(rings[rings.length - 1].pos) - height(rings[0].pos)).toBeGreaterThan(0.8);
        const out = new MergedParts();
        sweep(rings, sectionOf(SEGMENT), out);
        expect(out.indices.length / 3).toBe((rings.length - 1 - rings.filter((r, i) => i > 0 && r.cut).length) * 8);
    });
});

describe('belt end caps', () => {
    const capForward = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m);  // 端头网格沿 glTF +z 伸出
    const capAt = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);

    test('dangling ends: start cap at the first point turned 180°, end cap at the last point; long head on multi-belt paths', () => {
        const { paths } = straight3();
        const [path] = paths;
        const caps = capPlacements(path);
        expect(caps.map(c => c.kind)).toEqual(['head-long', 'head-long']);
        const first = path.points[0], last = path.points[path.points.length - 1];
        expect(capAt(caps[0].matrix).distanceTo(first.pos)).toBeLessThan(1e-6);
        expect(capForward(caps[0].matrix).dot(fwdOf(first.rot))).toBeCloseTo(-1, 5);
        expect(caps[0].building).toBe(path.buildingIndices[0]);
        expect(capAt(caps[1].matrix).distanceTo(last.pos)).toBeLessThan(1e-6);
        expect(capForward(caps[1].matrix).dot(fwdOf(last.rot))).toBeCloseTo(1, 5);
        expect(caps[1].building).toBe(path.buildingIndices[2]);
        // 端头的上方向就是带面法线
        expect(new Vector3(0, 1, 0).transformDirection(caps[1].matrix).dot(upOf(last.rot))).toBeCloseTo(1, 5);
    });

    test('a single lone belt uses the short head; an end that has an output gets no cap', () => {
        const lone = pathsOf([belt(0, 0, 0, -1)]).paths[0];
        expect(capPlacements(lone).map(c => c.kind)).toEqual(['head-short', 'head-short']);
        const fake: BeltPath = { ...lone, startCap: false, endCap: false };
        expect(capPlacements(fake)).toEqual([]);
    });
});

describe('belt cargo', () => {
    test('belt speed: beltSpeed points per tick × 60 tick/s × 0.06 m', () => {
        expect(beltMetersPerSecond(1)).toBeCloseTo(3.6);
        expect(beltMetersPerSecond(5)).toBeCloseTo(18);
    });

    test('plates sit every spacing metres and shift with the phase', () => {
        expect(cargoOffsets(5, 1.2, 0)).toEqual([0, 1.2, 2.4, 3.5999999999999996, 4.8]);
        const moved = cargoOffsets(5, 1.2, 0.5);
        expect(moved[0]).toBeCloseTo(0.5);
        expect(moved).toHaveLength(4);
        expect(cargoOffsets(5, 1.2, 1.7)[0]).toBeCloseTo(0.5);
        expect(cargoOffsets(0, 1.2, 0)).toEqual([]);
    });

    test('positions interpolate along the rings by arc length', () => {
        const { paths, transforms } = straight3();
        const [path] = paths;
        const rings = beltRings(path, beltNodes(path, transforms));
        const pos = new Vector3(), rot = new Quaternion();
        const total = rings[rings.length - 1].t;
        const i = sampleRings(rings, total / 2, pos, rot);
        expect(rings[i].t).toBeLessThanOrEqual(total / 2);
        expect(pos.distanceTo(rings[0].pos)).toBeCloseTo(total / 2, 2);
        sampleRings(rings, total + 5, pos, rot);
        expect(pos.distanceTo(rings[rings.length - 1].pos)).toBeLessThan(1e-9);
    });

    test('the plate is the game cargo size (0.5 × 0.5 footprint, 0.3 tall) with 18 triangles', () => {
        const g = cargoPlateGeometry();
        g.computeBoundingBox();
        const size = g.boundingBox!.getSize(new Vector3());
        expect(size.x).toBeCloseTo(0.5);
        expect(size.y).toBeCloseTo(0.5);
        expect(size.z).toBeCloseTo(0.3);
        expect(g.getAttribute('position').count / 3).toBe(18);
    });
});
