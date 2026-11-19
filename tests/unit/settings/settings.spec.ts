import { createSettings, defaultSettings, SETTINGS_KEY, StorageLike } from "@/settings";
import { nextTick } from "vue";

const memStorage = (init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
    const data = { ...init };
    return {
        data,
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => { data[k] = v; },
    };
};

describe('settings store', () => {
    it('starts with defaults when nothing is stored', () => {
        const s = createSettings(memStorage());
        expect({ ...s }).toEqual(defaultSettings());
        expect(defaultSettings()).toEqual({
            lang: 'auto', defaultMode: 'auto', viewMode: null, grid: true, flow: true, badges: true,
        });
    });

    it('persists changes and restores them in a new store (reload)', async () => {
        const storage = memStorage();
        const s = createSettings(storage);
        s.lang = 'en';
        s.defaultMode = 'box';
        s.viewMode = 'model';
        s.grid = false;
        s.flow = false;
        s.badges = false;
        await nextTick();
        expect(JSON.parse(storage.data[SETTINGS_KEY])).toMatchObject({ lang: 'en', defaultMode: 'box', grid: false });

        const again = createSettings(storage);
        expect({ ...again }).toEqual({
            lang: 'en', defaultMode: 'box', viewMode: 'model', grid: false, flow: false, badges: false,
        });
    });

    it('ignores corrupt or invalid stored values field by field', () => {
        expect({ ...createSettings(memStorage({ [SETTINGS_KEY]: '{not json' })) }).toEqual(defaultSettings());
        const s = createSettings(memStorage({
            [SETTINGS_KEY]: JSON.stringify({ lang: 'fr', defaultMode: 'fast', viewMode: 'box', grid: 'yes', flow: false }),
        }));
        expect({ ...s }).toEqual({ ...defaultSettings(), viewMode: 'box', flow: false });
    });

    it('works without storage or when storage throws', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const s = createSettings(null);
        s.grid = false;
        await nextTick();
        expect(s.grid).toBe(false);

        const broken: StorageLike = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('quota'); },
        };
        const b = createSettings(broken);
        expect({ ...b }).toEqual(defaultSettings());
        b.flow = false;
        await nextTick();
        expect(b.flow).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
