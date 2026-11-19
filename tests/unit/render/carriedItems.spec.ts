import { BlueprintBuilding, BlueprintData, IODir, LogisticRole, StationParameters } from '@/blueprint/parser';
import { inferCarriedItems } from '@/render/carriedItems';

const IRON_ORE = 1001;
const IRON_INGOT = 1101;
const GEAR = 1201;
const COPPER_ORE = 1002;
/** 铁块（1001 → 1101） */
const RECIPE_IRON = 1;

function building(index: number, itemId: number, extra: Partial<BlueprintBuilding> = {}): BlueprintBuilding {
    return {
        index, areaIndex: 0,
        localOffset: [{ x: index, y: 0, z: 0 }, { x: index, y: 0, z: 0 }],
        yaw: [0, 0], tilt: [0, 0], pitch: [0, 0],
        itemId, modelIndex: 0,
        outputObjIdx: -1, inputObjIdx: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0,
        recipeId: 0, filterId: 0, parameters: null, content: null,
        ...extra,
    };
}
const belt = (index: number, out: number, extra: Partial<BlueprintBuilding> = {}) =>
    building(index, 2001, { modelIndex: 35, outputObjIdx: out, ...extra });
/** 分拣器：从 from 取货放到 to */
const sorter = (index: number, from: number, to: number, extra: Partial<BlueprintBuilding> = {}) =>
    building(index, 2011, { modelIndex: 41, inputObjIdx: from, outputObjIdx: to, ...extra });
const smelter = (index: number, recipeId: number) => building(index, 2302, { modelIndex: 62, recipeId });

/** 物流站：storage 里的物品，slots[槽位] = [方向, storage 下标（从 1 起）] */
function station(index: number, items: number[], slots: Record<number, [IODir, number]>): BlueprintBuilding {
    const parameters = {
        storage: items.map(itemId => ({ itemId, max: 5000, localLogic: LogisticRole.None, remoteLogic: LogisticRole.None, keepMode: 0 })),
        slots: Array.from({ length: 12 }, (_, i) => slots[i]
            ? { dir: slots[i][0], storageIdx: slots[i][1] }
            : { dir: IODir.None, storageIdx: 0 }),
    } as unknown as StationParameters;
    return building(index, 2103, { modelIndex: 49, parameters });
}

const bp = (buildings: BlueprintBuilding[]) => ({ areas: [], buildings } as unknown as BlueprintData);
const entries = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]);

describe('inferCarriedItems', () => {
    test('upstream building output: a smelter feeds a belt chain through a sorter', () => {
        const items = inferCarriedItems(bp([
            smelter(0, RECIPE_IRON),
            sorter(1, 0, 2),
            belt(2, 3), belt(3, 4), belt(4, -1),
        ]));
        expect(entries(items)).toEqual([[1, IRON_INGOT], [2, IRON_INGOT], [3, IRON_INGOT], [4, IRON_INGOT]]);
    });

    test('a sorter that picks from a belt carries what the belt carries, and passes it on', () => {
        const items = inferCarriedItems(bp([
            smelter(0, RECIPE_IRON), sorter(1, 0, 2), belt(2, 3), belt(3, -1),
            sorter(4, 3, 5), belt(5, -1),
        ]));
        expect(items.get(4)).toBe(IRON_INGOT);
        expect(items.get(5)).toBe(IRON_INGOT);
    });

    test('sorter filter: the filter item wins over the source and marks the belt it picks from', () => {
        const items = inferCarriedItems(bp([
            // 从带上按过滤取齿轮送进熔炉：上游的带被推断为齿轮
            belt(0, 1), belt(1, -1), sorter(2, 1, 3, { filterId: GEAR }), smelter(3, RECIPE_IRON),
            // 从熔炉按过滤取货放到带上：过滤优先于配方产物
            smelter(4, RECIPE_IRON), sorter(5, 4, 6, { filterId: COPPER_ORE }), belt(6, -1),
        ]));
        expect(entries(items)).toEqual([[0, GEAR], [1, GEAR], [2, GEAR], [5, COPPER_ORE], [6, COPPER_ORE]]);
    });

    test('station slot: an output slot feeds its item downstream, an input slot marks the belts that lead into it', () => {
        const items = inferCarriedItems(bp([
            station(0, [IRON_ORE, GEAR], { 2: [IODir.Output, 1], 7: [IODir.Input, 2] }),
            belt(1, 2, { inputObjIdx: 0, inputFromSlot: 2 }), belt(2, -1),
            belt(3, 4), belt(4, 0, { outputToSlot: 7 }),
        ]));
        expect(entries(items)).toEqual([[1, IRON_ORE], [2, IRON_ORE], [3, GEAR], [4, GEAR]]);
    });

    test('a slot whose direction does not match, or with no storage item, implies nothing', () => {
        const items = inferCarriedItems(bp([
            station(0, [IRON_ORE, 0], { 2: [IODir.Input, 1], 3: [IODir.Output, 2] }),
            belt(1, -1, { inputObjIdx: 0, inputFromSlot: 2 }),
            belt(2, -1, { inputObjIdx: 0, inputFromSlot: 3 }),
        ]));
        expect(items.size).toBe(0);
    });

    test('what flows in from upstream wins over what a downstream slot asks for', () => {
        const items = inferCarriedItems(bp([
            smelter(0, RECIPE_IRON), sorter(1, 0, 2), belt(2, 3),
            belt(3, 4, { outputToSlot: 7 }),
            station(4, [GEAR], { 7: [IODir.Input, 1] }),
        ]));
        expect(items.get(2)).toBe(IRON_INGOT);
        expect(items.get(3)).toBe(IRON_INGOT);
    });

    test('none when unknown: bare belts, sorters between them, a smelter without a recipe', () => {
        const items = inferCarriedItems(bp([
            belt(0, 1), belt(1, -1),
            sorter(2, 1, 3), belt(3, -1),
            smelter(4, 0), sorter(5, 4, 6), belt(6, -1),
            // 指向不存在的建筑
            belt(7, 99, { inputObjIdx: 98 }),
        ]));
        expect(items.size).toBe(0);
    });

    test('belt loops terminate', () => {
        const items = inferCarriedItems(bp([
            belt(0, 1), belt(1, 2), belt(2, 0),
            smelter(3, RECIPE_IRON), sorter(4, 3, 1),
        ]));
        expect(entries(items)).toEqual([[0, IRON_INGOT], [1, IRON_INGOT], [2, IRON_INGOT], [4, IRON_INGOT]]);
    });
});
