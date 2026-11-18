import { readFileSync } from "fs";
import { join } from "path";
import { fromStr } from "@/blueprint/parser";
import { runParse, WorkerOut } from "@/open/parseCore";
import { createWorkerParser, WorkerLike } from "@/open/workerParser";
import { mapParseError } from "@/open/errorMap";

const fixture = readFileSync(join(__dirname, '../blueprint/fixtures/v0.10.35.txt'), 'utf8').trim();

/** 在同一线程内模拟 Worker：消息经 structuredClone，和真实 postMessage 一样 */
function fakeWorker(onPost: (code: string, reply: (m: WorkerOut) => void) => void): WorkerLike & { terminated: boolean } {
    const w: WorkerLike & { terminated: boolean } = {
        terminated: false,
        onmessage: null, onerror: null,
        postMessage(code: string) {
            Promise.resolve().then(() => onPost(code, m => w.onmessage?.({ data: structuredClone(m) } as MessageEvent<WorkerOut>)));
        },
        terminate() { w.terminated = true; },
    };
    return w;
}

describe('runParse (worker body)', () => {
    it('posts progress then a structured-cloneable result equal to a main-thread parse', () => {
        const msgs: WorkerOut[] = [];
        runParse(fixture, m => msgs.push(structuredClone(m)));
        const last = msgs[msgs.length - 1];
        expect(msgs.filter(m => m.type === 'progress').length).toBeGreaterThan(0);
        expect(last.type).toBe('done');
        if (last.type !== 'done') throw new Error();
        expect(last.data).toEqual(fromStr(fixture));
        // jest 的 vm realm 与 structuredClone 的 realm 不同，不能用 instanceof
        expect(Object.prototype.toString.call(last.data.header.time)).toBe('[object Date]');
        expect(Object.prototype.toString.call(last.data.tail)).toBe('[object Uint8Array]');
    });
    it('posts a serialised error that maps to the same user-facing kind', () => {
        const msgs: WorkerOut[] = [];
        runParse(fixture.replace('H4sI', 'H4sJ'), m => msgs.push(structuredClone(m)));
        const m = msgs[0];
        if (m.type !== 'error') throw new Error('expected error');
        expect(m.error.message).toBe('Checksum mismatch');
    });
});

describe('createWorkerParser', () => {
    it('resolves with the worker result, forwards progress and terminates the worker', async () => {
        let w!: ReturnType<typeof fakeWorker>;
        const parse = createWorkerParser({
            create: () => (w = fakeWorker((code, reply) => runParse(code, reply))),
            fallback: () => { throw new Error('should not fall back'); },
        });
        const progress: Array<[number, number]> = [];
        const d = await parse(fixture, { onProgress: (a, b) => progress.push([a, b]) });
        expect(d).toEqual(fromStr(fixture));
        expect(progress.length).toBeGreaterThan(0);
        expect(w.terminated).toBe(true);
    });
    it('rebuilds errors so mapParseError classifies them as before (RangeError, string, TypeError)', async () => {
        const mk = (err: unknown) => createWorkerParser({
            create: () => fakeWorker((_c, reply) => reply({ type: 'error', error: serialize(err) })),
            fallback: () => { throw new Error('no'); },
        });
        const kinds: string[] = [];
        for (const err of [new RangeError('Invalid DataView length'), 'incorrect header check', new TypeError('x'), new Error('Invalid start')]) {
            try { await mk(err)(fixture, {}); } catch (e) { kinds.push(mapParseError(e, fixture, '0.10.35').kind); }
        }
        expect(kinds).toEqual(['truncated', 'truncated', 'truncated', 'notBlueprint']);
    });
    it('falls back to the main thread when no Worker can be created', async () => {
        const parse = createWorkerParser({ create: () => null, fallback: (c, o) => fromStr(c, o) });
        expect(await parse(fixture, {})).toEqual(fromStr(fixture));
    });
    it('falls back when the worker fails to load (onerror)', async () => {
        const w = fakeWorker(() => undefined);
        w.postMessage = () => { Promise.resolve().then(() => w.onerror?.({} as ErrorEvent)); };
        const parse = createWorkerParser({ create: () => w, fallback: (c, o) => fromStr(c, o) });
        expect(await parse(fixture, {})).toEqual(fromStr(fixture));
        expect(w.terminated).toBe(true);
    });
});

import { serializeError } from "@/open/parseCore";
const serialize = serializeError;
