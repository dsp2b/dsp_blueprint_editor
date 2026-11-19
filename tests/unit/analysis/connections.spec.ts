import { BuildingInfo } from '@/blueprint/buildingInfo';
import type { BlueprintBuilding } from '@/blueprint/parser';
import { connectionSummary } from '@/analysis/connections';

const b = (index: number, itemId: number, link: Partial<BlueprintBuilding> = {}) => ({
    index, itemId, outputObjIdx: -1, inputObjIdx: -1,
    outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0, ...link,
} as BlueprintBuilding);

describe('connectionSummary', () => {
    // 制造台 0 ← 分拣器 1 ← 箱子 2；分拣器 3 从制造台 0 取到箱子 4
    const buildings = [
        b(0, 2303),
        b(1, 2011, { inputObjIdx: 2, outputObjIdx: 0, outputFromSlot: 1, outputToSlot: 0, inputToSlot: 0, inputFromSlot: 0 }),
        b(2, 2101),
        b(3, 2011, { inputObjIdx: 0, outputObjIdx: 4, outputFromSlot: 1, outputToSlot: 0, inputToSlot: 0, inputFromSlot: 1 }),
        b(4, 2101),
    ];
    const info = new BuildingInfo(buildings);

    test('a factory counts sorters feeding it as inputs and sorters taking from it as outputs', () => {
        const s = connectionSummary(buildings[0], info.adjacency);
        expect([s.inCount, s.outCount]).toEqual([1, 1]);
        expect(s.items).toEqual([{ itemId: 2011, count: 2 }]);
    });

    test('a sorter counts the building it picks from as its input', () => {
        const s = connectionSummary(buildings[1], info.adjacency);
        expect([s.inCount, s.outCount]).toEqual([1, 1]);
    });
});
