import { useBlueprintSession, SessionDeps } from "@/open/session";
import { BlueprintData } from "@/blueprint/parser";
import { reactive } from "vue";
import { IDBFactory } from "fake-indexeddb";
import { createRecentStore } from "@/open/recentStore";
import type { RecentEntry, RecentInput } from "@/open/recentStore";

const bp = (name = 'n') => ({ header: { shortDesc: name, icons: [1, 0, 0, 0, 0] }, buildings: new Array(3) } as unknown as BlueprintData);
const memStore = () => {
    let items: Array<RecentEntry | RecentInput> = [];
    return {
        items: () => items,
        list: async () => items,
        add: async (e: RecentInput) => { items = [e, ...items.filter(x => x.code !== e.code)].slice(0, 20); },
        clear: async () => { items = []; },
    };
};
const mk = (over: Partial<SessionDeps> = {}) => {
    const store = memStore();
    const s = useBlueprintSession({
        parse: (str: string) => { if (str === 'bad') throw new RangeError('Invalid DataView length'); return bp(str); },
        store, supported: '0.10.35', confirmReplace: async () => true, ...over,
    } as SessionDeps);
    return { s, store };
};

describe('useBlueprintSession', () => {
    it('opens a blueprint, records it as recent, fires opened', async () => {
        const { s, store } = mk();
        const opened = jest.fn();
        s.onOpened(opened);
        expect(await s.open('ok')).toBe(true);
        expect(s.data.value?.header.shortDesc).toBe('ok');
        expect(opened).toHaveBeenCalledTimes(1);
        expect(opened.mock.calls[0][0]).toBe(s.data.value);
        expect(store.items()[0].code).toBe('ok');
        expect(store.items()[0].name).toBe('ok');
        expect(s.recent.value).toHaveLength(1);
        expect(s.dirty.value).toBe(false);
    });
    it('shows a user-facing error and keeps the input, not firing opened', async () => {
        const { s } = mk();
        const opened = jest.fn(); s.onOpened(opened);
        expect(await s.open('bad')).toBe(false);
        expect(s.error.value?.kind).toBe('truncated');
        expect(s.input.value).toBe('bad');
        expect(s.data.value).toBeNull();
        expect(opened).not.toHaveBeenCalled();
    });
    it('keeps the current blueprint when a replacement fails', async () => {
        const { s } = mk();
        await s.open('ok');
        await s.open('bad');
        expect(s.data.value?.header.shortDesc).toBe('ok');
        expect(s.error.value).not.toBeNull();
    });
    it('asks before replacing an edited blueprint and aborts when declined', async () => {
        const confirmReplace = jest.fn(async () => false);
        const { s } = mk({ confirmReplace });
        await s.open('a');
        s.markDirty();
        expect(await s.open('b')).toBe(false);
        expect(confirmReplace).toHaveBeenCalledTimes(1);
        expect(s.data.value?.header.shortDesc).toBe('a');
        expect(s.dirty.value).toBe(true);
    });
    it('replaces after confirmation and does not ask when not dirty', async () => {
        const confirmReplace = jest.fn(async () => true);
        const { s } = mk({ confirmReplace });
        await s.open('a');
        await s.open('b');
        expect(confirmReplace).not.toHaveBeenCalled();
        s.markDirty();
        expect(await s.open('c')).toBe(true);
        expect(confirmReplace).toHaveBeenCalledTimes(1);
        expect(s.data.value?.header.shortDesc).toBe('c');
        expect(s.dirty.value).toBe(false);
    });
    it('close clears the blueprint, input and error', async () => {
        const { s } = mk();
        await s.open('bad'); await s.open('ok'); s.close();
        expect(s.data.value).toBeNull();
        expect(s.input.value).toBe('');
        expect(s.error.value).toBeNull();
    });
    it('clearRecent empties the list and the store', async () => {
        const { s, store } = mk();
        await s.open('ok');
        await s.clearRecent();
        expect(s.recent.value).toEqual([]);
        expect(store.items()).toEqual([]);
    });
    it('still opens when the recent store fails', async () => {
        const store = { list: async () => { throw new Error('no idb'); }, add: async () => { throw new Error('no idb'); }, clear: async () => undefined };
        const { s } = mk({ store });
        expect(await s.open('ok')).toBe(true);
    });
    it('saves to a real IndexedDB store even though the parsed header is a reactive proxy', async () => {
        const store = createRecentStore(new IDBFactory());
        const parse = () => {
            const d = bp('reactive name');
            d.header = reactive(d.header);
            return d;
        };
        const { s } = mk({ store, parse });
        await s.open('code');
        expect(s.recent.value.map(r => r.name)).toEqual(['reactive name']);
        expect(s.recent.value[0].icons).toEqual([1, 0, 0, 0, 0]);
    });
    describe('loading progress', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());
        it('becomes visible only after 300 ms and reports done/total', async () => {
            let finish!: () => void;
            let report!: (d: number, t: number) => void;
            const { s } = mk({
                parse: (str, o) => { report = o.onProgress!; return new Promise(r => { finish = () => r(bp(str)); }); },
            });
            const p = s.open('slow');
            await Promise.resolve();
            expect(s.loading.value.active).toBe(true);
            expect(s.loading.value.visible).toBe(false);
            jest.advanceTimersByTime(299);
            expect(s.loading.value.visible).toBe(false);
            report(5, 10);
            jest.advanceTimersByTime(2);
            expect(s.loading.value.visible).toBe(true);
            expect(s.loading.value).toMatchObject({ done: 5, total: 10 });
            finish(); await p;
            expect(s.loading.value.active).toBe(false);
            expect(s.loading.value.visible).toBe(false);
        });
        it('never shows for a fast parse', async () => {
            const { s } = mk();
            await s.open('ok');
            jest.advanceTimersByTime(1000);
            expect(s.loading.value.visible).toBe(false);
        });
    });
    it('fires opened with a consistent input even if a newer open starts while recents are saved', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>(r => { release = r; });
        const store = memStore();
        const slowStore = { ...store, add: async (e: RecentInput) => { await gate; await store.add(e); } };
        const { s } = mk({ store: slowStore } as Partial<SessionDeps>);
        const seen: string[] = [];
        s.onOpened(d => seen.push(`${d.header.shortDesc}:${s.input.value}`));
        const a = s.open('a');
        await new Promise(r => setTimeout(r, 0)); // a 已解析，正在写最近列表
        const b = s.open('bad');
        release();
        await Promise.all([a, b]);
        expect(seen).toEqual(['a:a']);
        expect(s.data.value?.header.shortDesc).toBe('a');
    });
    it('aborts the in-flight parse when a newer open or close supersedes it', async () => {
        const signals: AbortSignal[] = [];
        const parse = (str: string, o: { signal?: AbortSignal }) => {
            signals.push(o.signal!);
            return new Promise<BlueprintData>(() => undefined); // 永不完成
        };
        const { s } = mk({ parse } as unknown as Partial<SessionDeps>);
        void s.open('a');
        await new Promise(r => setTimeout(r, 0));
        void s.open('b');
        await new Promise(r => setTimeout(r, 0));
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        s.close();
        expect(signals[1].aborted).toBe(true);
    });
});
