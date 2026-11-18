import type { Object3D } from 'three';

/** GLTFLoader 解析结果里用得到的部分 */
export interface GLTFLike {
    scene: Object3D;
}

/** public/models/manifest.json 里一个建筑模型的条目（只列用得到的字段） */
export interface ManifestEntry {
    /** 最低一级 LOD 的文件 */
    file: string;
    bytes: number;
    /** 最高一级 LOD（与最低一级不同时才有） */
    lod0?: { file: string, bytes: number };
    /** 游戏里各级 LOD 的切换距离，lodDistances[0] 以内用 LOD0 */
    lodDistances?: number[];
}

export interface ModelManifest {
    buildings: Record<string, ManifestEntry>;
}

/** 下载与解析，测试里替换成假的实现 */
export interface GlbSource {
    /** onBytes 报告已收到的累计字节数 */
    fetch(url: string, onBytes?: (received: number) => void): Promise<ArrayBuffer>;
    parse(data: ArrayBuffer, url: string): Promise<GLTFLike>;
}

/** path 相对模型目录，例如 '62.glb'、'belt/belt-mk1.glb' */
export type LoadGlb = (path: string, onBytes?: (received: number) => void) => Promise<GLTFLike>;

/** 模型目录的 URL（<publicPath>models/） */
export function modelsBaseUrl() {
    return `${process.env.BASE_URL ?? '/'}models/`;
}

/**
 * 按路径缓存的 GLB 加载器：同一路径只下载一次，结果（几何体、材质）在调用方之间共享，
 * 调用方不应修改它们；下载或解析失败的路径会被忘掉，下次调用重新下载。
 * 下载进度报给所有在等这个路径的调用方（后来的先收到已下载的字节数）。
 */
export function createGlbLoader(source: GlbSource, base = modelsBaseUrl()): LoadGlb {
    interface Entry { promise: Promise<GLTFLike>, received: number, listeners: Set<(received: number) => void> }
    const cache = new Map<string, Entry>();
    return (path, onBytes) => {
        const e = cache.get(path);
        if (e === undefined) {
            const url = base + path;
            const entry: Entry = { promise: null!, received: 0, listeners: new Set(onBytes ? [onBytes] : []) };
            const report = (n: number) => {
                entry.received = n;
                for (const l of entry.listeners)
                    l(n);
            };
            entry.promise = source.fetch(url, report).then(data => source.parse(data, url));
            entry.promise.then(() => entry.listeners.clear(), () => {
                entry.listeners.clear();
                if (cache.get(path) === entry)
                    cache.delete(path);
            });
            cache.set(path, entry);
            return entry.promise;
        }
        if (onBytes) {
            if (e.received > 0)
                onBytes(e.received);
            e.listeners.add(onBytes);
        }
        return e.promise;
    };
}

async function fetchBytes(url: string, onBytes?: (received: number) => void) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`HTTP ${res.status} ${url}`);
    if (!onBytes || !res.body)
        return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value);
        received += value.byteLength;
        onBytes(received);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out.buffer;
}

const browserSource: GlbSource = {
    fetch: fetchBytes,
    async parse(data, url) {
        // 按需加载：精简模式不会下载 GLTFLoader 这个分块
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        return new GLTFLoader().parseAsync(data, url.slice(0, url.lastIndexOf('/') + 1));
    },
};

/** 全局共享的 GLB 加载器（建筑、传送带、分拣器模型都经过它） */
export const loadGlb: LoadGlb = createGlbLoader(browserSource);

let manifestPromise: Promise<ModelManifest> | null = null;
/** 读取模型清单；失败后下次调用重新请求 */
export function loadModelManifest(): Promise<ModelManifest> {
    if (manifestPromise === null) {
        const p = fetch(modelsBaseUrl() + 'manifest.json').then(res => {
            if (!res.ok)
                throw new Error(`HTTP ${res.status} manifest.json`);
            return res.json() as Promise<ModelManifest>;
        });
        manifestPromise = p;
        p.catch(() => {
            if (manifestPromise === p)
                manifestPromise = null;
        });
    }
    return manifestPromise;
}

// ───────── 逐类下载队列 ─────────

export interface ModelJob {
    /** 建筑模型编号 */
    key: number;
    /** 清单里这一类所有文件的字节数 */
    bytes: number;
    load(onBytes: (received: number) => void): Promise<void>;
}

export interface LoadProgress {
    /** 已显示真实模型的类型数 */
    done: number;
    total: number;
    failed: number;
    loadedBytes: number;
    totalBytes: number;
}

type JobState = 'pending' | 'running' | 'done' | 'failed';

/**
 * 按类型排队下载模型：最多同时 concurrency 个，只有 active 时才开始新的下载
 * （切回精简模式时暂停，正在下载的会完成）。失败的类型计数，retry 只重新下载失败的。
 */
export class ModelQueue {
    private state: JobState[];
    private received: number[];
    private running = 0;
    private active = false;
    private readonly concurrency: number;

    constructor(private readonly jobs: readonly ModelJob[], private readonly opts: { concurrency?: number, onChange?: (p: LoadProgress) => void } = {}) {
        this.state = jobs.map(() => 'pending');
        this.received = jobs.map(() => 0);
        this.concurrency = Math.max(1, opts.concurrency ?? 4);
    }

    get progress(): LoadProgress {
        let done = 0, failed = 0, loadedBytes = 0, totalBytes = 0;
        this.jobs.forEach((job, i) => {
            totalBytes += job.bytes;
            const s = this.state[i];
            if (s === 'done') {
                done++;
                loadedBytes += job.bytes;
            } else if (s === 'failed') {
                failed++;
            } else if (s === 'running') {
                loadedBytes += Math.min(this.received[i], job.bytes);
            }
        });
        return { done, total: this.jobs.length, failed, loadedBytes, totalBytes };
    }

    /** 没有排队或正在下载的类型 */
    get finished() {
        return this.state.every(s => s === 'done' || s === 'failed');
    }

    setActive(active: boolean) {
        this.active = active;
        this.pump();
    }

    retry() {
        let changed = false;
        this.state.forEach((s, i) => {
            if (s === 'failed') {
                this.state[i] = 'pending';
                this.received[i] = 0;
                changed = true;
            }
        });
        if (changed)
            this.changed();
        this.pump();
    }

    private changed() {
        this.opts.onChange?.(this.progress);
    }

    private pump() {
        while (this.active && this.running < this.concurrency) {
            const i = this.state.indexOf('pending');
            if (i < 0)
                return;
            this.state[i] = 'running';
            this.running++;
            this.jobs[i].load(n => {
                this.received[i] = n;
                this.changed();
            }).then(() => {
                this.state[i] = 'done';
            }, e => {
                console.warn(`model ${this.jobs[i].key} failed to load`, e);
                this.state[i] = 'failed';
            }).then(() => {
                this.running--;
                this.changed();
                this.pump();
            });
        }
    }
}

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

/** vue-i18n 的 t(key, named[, plural])；文案见 messages.ts */
export type Translate = (key: string, named: Record<string, unknown>, plural?: number) => string;

/** 进度提示的文字：下载中显示完成数与 MB，有失败时说明失败的类型数 */
export function progressText(p: LoadProgress, t: Translate) {
    if (p.done + p.failed >= p.total)
        return t('modelPill.failed', { failed: p.failed }, p.failed);
    const named = { done: p.done, total: p.total, failed: p.failed, loaded: mb(p.loadedBytes), size: mb(p.totalBytes) };
    return t(p.failed ? 'modelPill.loadingFailed' : 'modelPill.loading', named);
}
