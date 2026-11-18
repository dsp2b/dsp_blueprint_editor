import { readFileSync } from "fs";
import { join } from "path";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Vector3, WebGLRenderer } from "three";
import { BlueprintBuilding, fromStr } from "@/blueprint/parser";
import { calcBuildingTrans, findPosForAreas } from "@/blueprint/planet";
import { buildingMeta } from "@/data/building";
import { isBelt, isInserter, itemsMap } from "@/data/items";
import { IconGeometry } from "@/icons";
import { IconTexture } from "@/iconTexture";
import { createI18n } from "vue-i18n";
import { createGlbLoader, GLTFLike, LoadProgress, ModelJob, ModelManifest, ModelQueue, progressText, Translate } from "@/render/real/loader";
import { modelPillMessages } from "@/render/real/messages";
import { cullOverlaps } from "@/render/real/badges";
import { createRealLayer } from "@/render/real";
import type { LayerContext } from "@/render/layers";

interface Deferred<T> {
    promise: Promise<T>;
    resolve(v: T): void;
    reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
// 下载失败时会打印警告，测试里不需要
beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { jest.restoreAllMocks(); });

/** 让排队的 promise 回调都跑完 */
const flush = () => new Promise(r => setTimeout(r, 0));

/** 每个任务由测试手动完成/失败，并记录启动次数 */
function controlledJobs(bytes: number[]) {
    const runs: { key: number, d: Deferred<void>, onBytes: (n: number) => void }[] = [];
    const jobs: ModelJob[] = bytes.map((b, key) => ({
        key, bytes: b,
        load(onBytes) {
            const d = deferred<void>();
            runs.push({ key, d, onBytes });
            return d.promise;
        },
    }));
    const latest = (key: number) => [...runs].reverse().find(r => r.key === key)!;
    return { jobs, runs, latest };
}

describe('ModelQueue', () => {
    it('counts finished types and downloaded bytes, including partially downloaded files', async () => {
        const { jobs, latest } = controlledJobs([400, 600, 100]);
        const seen: LoadProgress[] = [];
        const q = new ModelQueue(jobs, { concurrency: 3, onChange: p => seen.push({ ...p }) });
        q.setActive(true);
        expect(q.progress).toEqual({ done: 0, total: 3, failed: 0, loadedBytes: 0, totalBytes: 1100 });

        latest(1).onBytes(250);
        expect(q.progress.loadedBytes).toBe(250);
        // 报告的字节数超过清单里的大小时不超过该类型的大小
        latest(1).onBytes(9999);
        expect(q.progress.loadedBytes).toBe(600);

        latest(0).d.resolve();
        await flush();
        expect(q.progress).toMatchObject({ done: 1, total: 3, failed: 0, loadedBytes: 1000 });
        latest(1).d.resolve();
        latest(2).d.resolve();
        await flush();
        expect(q.progress).toEqual({ done: 3, total: 3, failed: 0, loadedBytes: 1100, totalBytes: 1100 });
        expect(q.finished).toBe(true);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1].done).toBe(3);
    });

    it('limits parallel downloads to the concurrency', async () => {
        const { jobs, runs, latest } = controlledJobs([1, 1, 1, 1, 1]);
        const q = new ModelQueue(jobs, { concurrency: 2 });
        q.setActive(true);
        expect(runs.map(r => r.key)).toEqual([0, 1]);
        latest(0).d.resolve();
        await flush();
        expect(runs.map(r => r.key)).toEqual([0, 1, 2]);
    });

    it('counts failed types without affecting the others, and retry reloads only the failed ones', async () => {
        const { jobs, runs, latest } = controlledJobs([100, 200, 300]);
        const q = new ModelQueue(jobs, { concurrency: 3 });
        q.setActive(true);
        latest(1).onBytes(150);
        latest(1).d.reject(new Error('HTTP 404'));
        latest(0).d.resolve();
        latest(2).d.resolve();
        await flush();
        // 失败的类型不计入已下载字节
        expect(q.progress).toEqual({ done: 2, total: 3, failed: 1, loadedBytes: 400, totalBytes: 600 });
        expect(q.finished).toBe(true);

        const before = runs.length;
        q.retry();
        expect(runs.slice(before).map(r => r.key)).toEqual([1]);
        expect(q.progress).toMatchObject({ done: 2, failed: 0 });
        expect(q.finished).toBe(false);
        latest(1).d.resolve();
        await flush();
        expect(q.progress).toEqual({ done: 3, total: 3, failed: 0, loadedBytes: 600, totalBytes: 600 });
    });

    it('starts nothing while inactive and launches no new downloads after being paused', async () => {
        const { jobs, runs, latest } = controlledJobs([1, 1, 1]);
        const q = new ModelQueue(jobs, { concurrency: 1 });
        q.retry();
        expect(runs).toHaveLength(0);
        q.setActive(true);
        expect(runs).toHaveLength(1);
        q.setActive(false);
        latest(0).d.resolve();
        await flush();
        expect(runs).toHaveLength(1);
        expect(q.progress.done).toBe(1);
        q.setActive(true);
        expect(runs).toHaveLength(2);
    });
});

describe('createGlbLoader', () => {
    const gltf = (): GLTFLike => ({ scene: new Group() });

    it('downloads each path once under the models base URL and shares the result', async () => {
        const fetch = jest.fn<Promise<ArrayBuffer>, [string]>(async () => new ArrayBuffer(8));
        const parse = jest.fn(async () => gltf());
        const loadGlb = createGlbLoader({ fetch, parse }, '/base/models/');
        const [a, b] = await Promise.all([loadGlb('62.glb'), loadGlb('62.glb')]);
        expect(a).toBe(b);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe('/base/models/62.glb');
        await loadGlb('belt/belt-mk1.glb');
        expect(fetch.mock.calls[1][0]).toBe('/base/models/belt/belt-mk1.glb');
    });

    it('reports download progress to every caller waiting on the same path, not only the first', async () => {
        let report: (n: number) => void = () => undefined;
        const body = deferred<ArrayBuffer>();
        const fetch = jest.fn((_url: string, onBytes?: (n: number) => void) => { report = onBytes ?? report; return body.promise; });
        const loadGlb = createGlbLoader({ fetch, parse: async () => gltf() }, '/m/');
        const first: number[] = [], second: number[] = [];
        const a = loadGlb('62.glb', n => first.push(n));
        report(100);
        const b = loadGlb('62.glb', n => second.push(n));
        report(250);
        body.resolve(new ArrayBuffer(8));
        await Promise.all([a, b]);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(first).toEqual([100, 250]);
        // 后来的调用方先拿到已收到的字节数，再跟着后续进度
        expect(second).toEqual([100, 250]);
    });

    it('forgets a failed download so that a retry fetches it again', async () => {
        let fail = true;
        const fetch = jest.fn<Promise<ArrayBuffer>, [string]>(async () => {
            if (fail)
                throw new Error('offline');
            return new ArrayBuffer(8);
        });
        const loadGlb = createGlbLoader({ fetch, parse: async () => gltf() }, '/m/');
        await expect(loadGlb('62.glb')).rejects.toThrow('offline');
        fail = false;
        await expect(loadGlb('62.glb')).resolves.toBeDefined();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reports received bytes to the caller', async () => {
        const loadGlb = createGlbLoader({
            fetch: async (_url, onBytes) => { onBytes?.(10); onBytes?.(30); return new ArrayBuffer(30); },
            parse: async () => gltf(),
        }, '/m/');
        const got: number[] = [];
        await loadGlb('1.glb', n => got.push(n));
        expect(got).toEqual([10, 30]);
    });
});

describe('progressText (copy goes through vue-i18n)', () => {
    const p = (o: Partial<LoadProgress>): LoadProgress => ({ done: 0, total: 0, failed: 0, loadedBytes: 0, totalBytes: 0, ...o });
    const i18n = createI18n({ legacy: false, locale: 'zh', messages: modelPillMessages });
    const tr = (lang: 'zh' | 'en'): Translate => (key, named, plural) => {
        i18n.global.locale.value = lang;
        return plural === undefined ? i18n.global.t(key, named) : i18n.global.t(key, named, plural);
    };

    it('shows done/total types and MB', () => {
        expect(progressText(p({ done: 2, total: 4, loadedBytes: 400_000, totalBytes: 1_100_000 }), tr('zh')))
            .toBe('正在下载建筑模型 2/4（0.4 / 1.1 MB）');
        expect(progressText(p({ done: 2, total: 4, loadedBytes: 400_000, totalBytes: 1_100_000 }), tr('en')))
            .toBe('Downloading building models 2/4 (0.4 / 1.1 MB)');
    });

    it('names the failed count', () => {
        expect(progressText(p({ done: 3, total: 4, failed: 1, loadedBytes: 1e6, totalBytes: 1.1e6 }), tr('zh')))
            .toBe('1 种建筑模型下载失败，仍显示为方盒');
        expect(progressText(p({ done: 1, total: 4, failed: 1, loadedBytes: 1e5, totalBytes: 1.1e6 }), tr('zh')))
            .toBe('正在下载建筑模型 1/4（0.1 / 1.1 MB），1 种失败');
        expect(progressText(p({ done: 3, total: 4, failed: 1, loadedBytes: 1e6, totalBytes: 1.1e6 }), tr('en')))
            .toBe('1 building model failed to download and stays a box');
        expect(progressText(p({ done: 2, total: 4, failed: 2, loadedBytes: 1e6, totalBytes: 1.1e6 }), tr('en')))
            .toBe('2 building models failed to download and stay boxes');
        expect(progressText(p({ done: 1, total: 4, failed: 1, loadedBytes: 1e5, totalBytes: 1.1e6 }), tr('en')))
            .toBe('Downloading building models 1/4 (0.1 / 1.1 MB), 1 failed');
        expect(tr('en')('modelPill.retry', {})).toBe('Retry');
        expect(tr('zh')('modelPill.retry', {})).toBe('重试');
    });
});

describe('cullOverlaps', () => {
    it('keeps the nearest of overlapping badges and every badge that does not overlap', () => {
        // 0 与 1 重叠（1 更近），2 远离，3 与 0 重叠但 0 已被挤掉，所以 3 与 1 比较
        const xs = [100, 110, 400, 90];
        const ys = [100, 104, 100, 130];
        const depth = [5, 2, 3, 4];
        const visible = cullOverlaps(xs, ys, depth, [1, 1, 1, 1], 24);
        expect(Array.from(visible)).toEqual([0, 1, 1, 1]);
    });

    it('ignores candidates that are hidden (off screen or behind the planet)', () => {
        const visible = cullOverlaps([100, 105], [100, 100], [1, 2], [0, 1], 24);
        expect(Array.from(visible)).toEqual([0, 1]);
    });

    it('shows more badges as they spread apart on screen (zooming in)', () => {
        const n = 50;
        const at = (spacing: number) => {
            const xs = Array.from({ length: n }, (_v, i) => (i % 10) * spacing);
            const ys = Array.from({ length: n }, (_v, i) => Math.floor(i / 10) * spacing);
            const v = cullOverlaps(xs, ys, xs.map((_x, i) => i), xs.map(() => 1), 24);
            return v.reduce((a, b) => a + b, 0);
        };
        expect(at(6)).toBeLessThan(at(30));
        expect(at(30)).toBe(n);
    });
});

// ───────── 真实模型图层：精简模式从不下载模型 ─────────

const R = 200.2;

/** 取三种有选中框、非传送带/分拣器的建筑做一个小蓝图 */
function sampleBlueprint() {
    const base = fromStr(readFileSync(join(__dirname, '..', 'blueprint', 'fixtures', 'v0.10.35.txt'), 'utf8').trim());
    const kinds = [...itemsMap.values()]
        .filter(it => it.models?.length && !isBelt(it.id) && !isInserter(it.id) && buildingMeta.has(it.models[0]))
        .slice(0, 3);
    const buildings: BlueprintBuilding[] = [];
    kinds.forEach((it, k) => {
        for (let j = 0; j < 2; j++) {
            const src = base.buildings[0];
            const off = (o: BlueprintBuilding['localOffset'][0]) => ({ x: o.x + k * 8, y: o.y + j * 8, z: o.z });
            buildings.push({ ...src, index: buildings.length, itemId: it.id, modelIndex: it.models[0], recipeId: 0, localOffset: [off(src.localOffset[0]), off(src.localOffset[1])] });
        }
    });
    const data = { ...base, buildings };
    const pos = findPosForAreas(data.areas, 200);
    const transforms = buildings.map(b => calcBuildingTrans(R, pos, b));
    const fakeRenderer = {
        domElement: { parentElement: null },
        getPixelRatio: () => 1,
        getDrawingBufferSize: (v: { set(x: number, y: number): unknown }) => v.set(800, 600),
    } as unknown as WebGLRenderer;
    const ctx: LayerContext = {
        root: new Group(), renderer: fakeRenderer, camera: new PerspectiveCamera(), R, data, buildings, transforms,
        icons: new IconGeometry(buildings.length),
        iconTexture: { requestIcon: () => 1 } as unknown as IconTexture,
        view: { flow: true, badges: true, reducedMotion: false },
    };
    const manifest: ModelManifest = { buildings: {} };
    for (const it of kinds)
        manifest.buildings[String(it.models[0])] = { file: `${it.models[0]}.glb`, bytes: 1000, lodDistances: [100] };
    return { ctx, kinds, manifest };
}

const modelGltf = (): GLTFLike => {
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
    return { scene };
};

/** 这类建筑已换成真实模型（场景里有它的实例化模型组） */
const modelShown = (root: Object3D, modelIndex: number) => root.getObjectByName(`model-${modelIndex}`) !== undefined;

describe('real model layer', () => {
    it('never requests the manifest or any model while it stays hidden (Simple mode)', async () => {
        const { ctx, manifest } = sampleBlueprint();
        const loadManifest = jest.fn(async () => manifest);
        const loadGlb = jest.fn<Promise<GLTFLike>, [string]>(async () => modelGltf());
        const layer = createRealLayer({ loadManifest, loadGlb });
        layer.build(ctx);
        layer.setVisible(false);
        for (let i = 0; i < 5; i++)
            layer.update(1 / 60);
        layer.setHighlight?.(null);
        layer.setSelected?.(new Set([0]));
        await flush();
        expect(loadManifest).not.toHaveBeenCalled();
        expect(loadGlb).not.toHaveBeenCalled();
        layer.dispose();
    });

    it('loads every building type once it is shown, keeping failed types as boxes until retry', async () => {
        const { ctx, kinds, manifest } = sampleBlueprint();
        const failing = `${kinds[1].models[0]}.glb`;
        let fail = true;
        const loadGlb = jest.fn(async (path: string) => {
            if (fail && path === failing)
                throw new Error('blocked');
            return modelGltf();
        });
        const layer = createRealLayer({ loadManifest: async () => manifest, loadGlb });
        layer.build(ctx);
        layer.setVisible(true);
        await flush();
        await flush();
        expect(loadGlb.mock.calls.map(c => c[0]).sort()).toEqual(kinds.map(k => `${k.models[0]}.glb`).sort());
        expect(layer.progress).toMatchObject({ done: 2, total: 3, failed: 1 });
        expect(modelShown(ctx.root, kinds[0].models[0])).toBe(true);
        expect(modelShown(ctx.root, kinds[1].models[0])).toBe(false);

        fail = false;
        layer.retry();
        await flush();
        await flush();
        expect(layer.progress).toMatchObject({ done: 3, total: 3, failed: 0 });
        expect(modelShown(ctx.root, kinds[1].models[0])).toBe(true);
        layer.dispose();
    });

    it('stands models upright without mirroring: glTF (x, y, z) → building local (−x, z, y)', async () => {
        const { ctx, manifest } = sampleBlueprint();
        const layer = createRealLayer({ loadManifest: async () => manifest, loadGlb: async () => modelGltf() });
        layer.build(ctx);
        layer.setVisible(true);
        await flush();
        await flush();
        const b = ctx.buildings[0];
        let mesh: InstancedMesh | null = null;
        ctx.root.traverse(o => {
            if (!mesh && (o as InstancedMesh).isInstancedMesh && o.name === 'lod1' && o.parent?.name === `model-${b.modelIndex}`)
                mesh = o as InstancedMesh;
        });
        expect(mesh).not.toBeNull();
        const inst = new Matrix4();
        mesh!.getMatrixAt(0, inst);
        const local = new Matrix4().copy(ctx.transforms[b.index][0]).invert().multiply(inst);
        const axis = (x: number, y: number, z: number) => new Vector3(x, y, z).transformDirection(local).toArray().map(v => Math.round(v) + 0);
        expect(axis(0, 1, 0)).toEqual([0, 0, 1]);
        expect(axis(0, 0, 1)).toEqual([0, 1, 0]);
        expect(axis(1, 0, 0)).toEqual([-1, 0, 0]);
        expect(local.determinant()).toBeCloseTo(1);
        layer.dispose();
    });

    it('stops starting new downloads when switched back to Simple', async () => {
        const { ctx, manifest } = sampleBlueprint();
        const pending: Deferred<GLTFLike>[] = [];
        const loadGlb = jest.fn<Promise<GLTFLike>, [string]>(() => { const d = deferred<GLTFLike>(); pending.push(d); return d.promise; });
        const layer = createRealLayer({ loadManifest: async () => manifest, loadGlb, concurrency: 1 });
        layer.build(ctx);
        layer.setVisible(true);
        await flush();
        expect(loadGlb).toHaveBeenCalledTimes(1);
        layer.setVisible(false);
        pending[0].resolve(modelGltf());
        await flush();
        expect(loadGlb).toHaveBeenCalledTimes(1);
        layer.dispose();
    });
});
