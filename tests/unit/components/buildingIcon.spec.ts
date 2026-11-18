import { findAll, flushPromises, mountRecorded } from './recordRenderer';

jest.mock('@/data/icons', () => ({
    iconUrl: (id: number) => {
        if (id === 1) throw new TypeError("Cannot read properties of undefined (reading 'icon')");
        if (id === 2) return Promise.reject(new Error('missing png'));
        return Promise.resolve(`/icons/${id}.png`);
    },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BuildingIcon = require('@/components/BuildingIcon.vue').default;

describe('BuildingIcon', () => {
    // 激光灯塔等可以指向游戏里不存在的图标 id
    test.each([1, 2])('an unknown icon id %i shows no image instead of raising', async iconId => {
        const errorHandler = jest.fn();
        const { root, unmount } = mountRecorded(BuildingIcon, { iconId }, app => { app.config.errorHandler = errorHandler; });
        await flushPromises();
        expect(errorHandler).not.toHaveBeenCalled();
        expect(findAll(root, 'img').map(i => i.props.src)).toEqual(['']);
        unmount();
    });

    test('a known icon id resolves to its URL', async () => {
        const { root, unmount } = mountRecorded(BuildingIcon, { iconId: 1101 });
        await flushPromises();
        expect(findAll(root, 'img').map(i => i.props.src)).toEqual(['/icons/1101.png']);
        unmount();
    });
});
