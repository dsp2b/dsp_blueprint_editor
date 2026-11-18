import { ref } from 'vue';
import type { BlueprintBuilding } from '@/blueprint/parser';
import { findAll, mountRecorded } from './recordRenderer';

jest.mock('@/define', () => ({ commandQueueKey: Symbol.for('commandQueue') }));
jest.mock('@/data/icons', () => ({
    ...jest.requireActual('@/data/icons'),
    iconUrl: () => Promise.resolve('/icon.png'),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BuildingInfoPanel = require('@/components/BuildingInfoPanel.vue').default;

const hook = { onMounted: () => undefined };
const queue = ref({ updater: { updateSorterIcon: hook, updateBeltIcon: hook } });

const building = (itemId: number, recipeId = 0): BlueprintBuilding => ({
    index: 0, areaIndex: 0,
    localOffset: [{ x: 1, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }],
    yaw: [0, 0], tilt: [0, 0], pitch: [0, 0],
    itemId, modelIndex: 0,
    outputObjIdx: -1, inputObjIdx: -1,
    outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
    outputOffset: 0, inputOffset: 0,
    recipeId, filterId: 0,
    parameters: null, content: null,
});

const mount = (b: BlueprintBuilding) => {
    return mountRecorded(BuildingInfoPanel, { building: b }, app => app.provide(Symbol.for('commandQueue'), queue));
};

describe('BuildingInfoPanel with a building whose parameter block is empty', () => {
    // 参数块长度为 0 时解析器给 parameters = null（手写/第三方蓝图、旧版本建筑）
    test.each([
        ['lab', 2901, 0],
        ['inserter', 2011, 0],
        ['ejector', 2311, 0],
        ['energy exchanger', 2209, 0],
        ['ray receiver', 2208, 0],
        ['artificial star', 2210, 0],
        ['tank', 2106, 0],
        ['station', 2103, 0],
        ['monitor', 2030, 0],
        ['battle base', 3009, 0],
        ['storage', 2101, 0],
        ['dispenser', 2107, 0],
        ['assembler with a productive recipe', 2303, 5],
    ])('%s (item %i) renders its header instead of throwing', (_name, itemId, recipeId) => {
        const { root, unmount } = mount(building(itemId, recipeId));
        expect(findAll(root, 'h3').length).toBeGreaterThan(0);
        unmount();
    });
});
