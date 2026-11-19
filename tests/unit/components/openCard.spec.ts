import OpenCard from '@/components/open/OpenCard.vue';
import { recentIconUrls } from '@/open/recentIcons';
import { findAll, flushPromises, mountRecorded } from './recordRenderer';

jest.mock('@/data/icons', () => ({
    iconUrl: (id: number) => Promise.resolve(`/icons/${id}.png`),
}));

const mount = (recent: unknown[]) => mountRecorded(OpenCard, {
    input: '', error: null, supported: '0.10.35', recent,
    loading: { active: false, visible: false, done: 0, total: 0 },
});

describe('OpenCard recent entries', () => {
    test('passes a resolved URL string, never a Promise, as the recent-entry image src', async () => {
        const { root, unmount } = mount([{ id: 'a', code: 'BLUEPRINT:1', name: 'bp', icons: [0, 1101], openedAt: 0 }]);
        for (const img of findAll(root, 'img'))
            expect(typeof img.props.src).toBe('string');
        await flushPromises();
        const srcs = findAll(root, 'img').map(i => i.props.src);
        expect(srcs).toEqual(['/icons/1101.png']);
        unmount();
    });
});

describe('recentIconUrls', () => {
    test('resolves the first positive icon of each entry and maps failures to empty', async () => {
        const resolve = (id: number) => id === 9999 ? Promise.reject(new Error('missing')) : Promise.resolve(`/i/${id}.png`);
        const urls = await recentIconUrls([
            { id: 'a', icons: [0, 1101, 1102] },
            { id: 'b', icons: [0, 0] },
            { id: 'c', icons: [9999] },
            { id: 'd', icons: [] },
        ], resolve);
        expect(urls).toEqual({ a: '/i/1101.png', b: '', c: '', d: '' });
    });

    test('maps a synchronous throw (unknown item id) to empty', async () => {
        const urls = await recentIconUrls([{ id: 'a', icons: [5] }], () => { throw new TypeError('no item'); });
        expect(urls).toEqual({ a: '' });
    });
});
