import { Matrix4, Texture, TextureLoader, Vector2, Vector3, WebGLRenderer } from 'three';
import type { BeltParameters, BlueprintBuilding } from '@/blueprint/parser';
import { IconGeometry } from '@/icons';
import { IconSubscript } from '@/iconSubscript';

jest.mock('@/data/icons', () => ({
    ...jest.requireActual('@/data/icons'),
    iconUrl: async (id: number) => `/icons/${id}.png`,
}));

// 没有 jsdom：IconTexture / FontTexture 只需要 canvas 的尺寸与 2D 上下文的几个方法
const ctx2d = {
    measureText: () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    strokeText: () => undefined, fillText: () => undefined,
};
beforeAll(() => {
    (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
});
afterAll(() => { delete (globalThis as { document?: unknown }).document; });
afterEach(() => jest.restoreAllMocks());
const flush = () => new Promise(r => setTimeout(r, 0));

const fakeRenderer = () => ({
    initTexture: jest.fn(),
    copyTextureToTexture: jest.fn(),
}) as unknown as WebGLRenderer & { copyTextureToTexture: jest.Mock };

function building(index: number, extra: Partial<BlueprintBuilding>): BlueprintBuilding {
    return {
        index, areaIndex: 0,
        localOffset: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
        yaw: [0, 0], tilt: [0, 0], pitch: [0, 0],
        itemId: 2001, modelIndex: 35,
        outputObjIdx: -1, inputObjIdx: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0,
        recipeId: 0, filterId: 0, parameters: null, content: null,
        ...extra,
    };
}

describe('IconTexture', () => {
    test('does not copy into the atlas once it has been disposed (switching blueprints mid-load)', async () => {
        const { IconTexture } = await import('@/iconTexture');
        let finish: (t: Texture) => void = () => undefined;
        jest.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(r => { finish = r; }));
        const renderer = fakeRenderer();
        const atlas = new IconTexture(renderer);
        atlas.requestIcon(1101);
        await flush();
        atlas.dispose();
        finish(new Texture());
        await flush();
        expect(renderer.copyTextureToTexture).not.toHaveBeenCalled();
    });

    test('a failed icon load is retried on the next request instead of staying blank', async () => {
        const { IconTexture } = await import('@/iconTexture');
        const load = jest.spyOn(TextureLoader.prototype, 'loadAsync')
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(new Texture());
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const renderer = fakeRenderer();
        const atlas = new IconTexture(renderer);
        const slot = atlas.requestIcon(1101);
        await flush();
        expect(atlas.requestIcon(1101)).toBe(slot);
        await flush();
        expect(load).toHaveBeenCalledTimes(2);
        expect(renderer.copyTextureToTexture).toHaveBeenCalledTimes(1);
    });
});

describe('badges', () => {
    test('disposing the badges also frees the belt-count subscript material and font texture', async () => {
        const { buildBadges } = await import('@/render/core/badges');
        jest.spyOn(TextureLoader.prototype, 'loadAsync').mockResolvedValue(new Texture());
        const belt = building(0, { parameters: { iconId: 1101, count: 12 } as BeltParameters });
        const badges = buildBadges(fakeRenderer(), [belt], [[new Matrix4(), new Matrix4()]]);
        const sub = badges.group.children.find(c => c instanceof IconSubscript) as IconSubscript;
        expect(sub).toBeDefined();
        const material = jest.spyOn(sub.material as unknown as { dispose(): void }, 'dispose');
        const font = jest.spyOn(sub.fontTexture.texture, 'dispose');
        badges.dispose();
        expect(material).toHaveBeenCalled();
        expect(font).toHaveBeenCalled();
    });

    test('a recipe the data does not know (newer game version) falls back to the building icon', async () => {
        const { buildingIconId } = await import('@/render/core/badges');
        const smelter = building(0, { itemId: 2302, modelIndex: 62, recipeId: 99999 });
        expect(buildingIconId(smelter)).toBe(2302);
    });
});

describe('IconGeometry', () => {
    test('an icon added while a highlight is active is dimmed like the others', () => {
        const a = building(0, {}), b = building(1, {});
        const icons = new IconGeometry(4);
        icons.addIcon(a, 1, new Vector3(), new Vector2(1, 1));
        icons.setDim(x => x === b);
        icons.addIcon(b, 2, new Vector3(), new Vector2(1, 1), true);
        const dim = icons.getAttribute('iconDim').array;
        expect(Array.from(dim.slice(0, 2))).toEqual([0, 1]);
    });
});
