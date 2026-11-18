import { IDBFactory } from "fake-indexeddb";
import { createRecentStore, RECENT_LIMIT } from "@/open/recentStore";

const make = () => createRecentStore(new IDBFactory());
const item = (n: number) => ({ code: 'BLUEPRINT:' + n, name: 'bp' + n, icons: [n] });

describe('recentStore', () => {
    it('lists newest first', async () => {
        const s = make();
        await s.add(item(1)); await s.add(item(2));
        expect((await s.list()).map(e => e.name)).toEqual(['bp2', 'bp1']);
    });
    it('de-duplicates the same code and moves it to the top, updating metadata', async () => {
        const s = make();
        await s.add(item(1)); await s.add(item(2));
        await s.add({ ...item(1), name: 'renamed' });
        const l = await s.list();
        expect(l.map(e => e.name)).toEqual(['renamed', 'bp2']);
        expect(l[0].code).toBe('BLUEPRINT:1');
    });
    it('keeps only the 20 most recent', async () => {
        const s = make();
        expect(RECENT_LIMIT).toBe(20);
        for (let i = 0; i < 25; i++) await s.add(item(i));
        const l = await s.list();
        expect(l).toHaveLength(20);
        expect(l[0].name).toBe('bp24');
        expect(l[19].name).toBe('bp5');
    });
    it('clears everything', async () => {
        const s = make();
        await s.add(item(1));
        await s.clear();
        expect(await s.list()).toEqual([]);
    });
    it('persists across store instances on the same database', async () => {
        const f = new IDBFactory();
        await createRecentStore(f).add(item(1));
        expect((await createRecentStore(f).list()).map(e => e.name)).toEqual(['bp1']);
    });
});
