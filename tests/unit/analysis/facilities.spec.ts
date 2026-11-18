import { facilityGroup, footprintCells, tierOf } from '@/analysis/facilities';
import { analyzeMaterialFlow } from '@/analysis/materialFlow';
import { gameEnv } from '@/analysis/gameEnv';

describe('facilityGroup (build bar row of Item.buildIndex)', () => {
    it.each([
        [301, 'logistics'], [401, 'logistics'], [602, 'logistics'], [603, 'logistics'],
        [201, 'production'], [501, 'production'], [801, 'production'], [802, 'production'], [807, 'production'],
        [101, 'power'], [109, 'power'], [606, 'power'], [803, 'power'], [805, 'power'],
        [701, 'defence'], [710, 'defence'],
        [901, 'other'], [902, 'other'], [0, 'other'],
    ])('%i -> %s', (buildIndex, group) => {
        expect(facilityGroup(buildIndex)).toBe(group);
    });
});

describe('tierOf', () => {
    it('is the 1-3 colour tier for upgrade lines, null otherwise', () => {
        expect(tierOf({ grade: 1, upgrades: [1, 2, 3] })).toBe(1);
        expect(tierOf({ grade: 4, upgrades: [1, 2, 3, 4] })).toBe(3);
        expect(tierOf({ grade: 0, upgrades: [] })).toBeNull();
        expect(tierOf({ grade: 1, upgrades: [5] })).toBeNull();
        expect(tierOf({})).toBeNull();
    });
});

describe('footprintCells', () => {
    it('is width x height for one area and the cell total for several', () => {
        expect(footprintCells([{ size: { x: 40, y: 18 } }])).toEqual({ width: 40, height: 18, cells: 720 });
        expect(footprintCells([{ size: { x: 4, y: 3 } }, { size: { x: 2, y: 2 } }])).toEqual({ width: null, height: null, cells: 16 });
        expect(footprintCells([])).toEqual({ width: null, height: null, cells: 0 });
    });
});

describe('gameEnv with generated data', () => {
    // assembler Mk.I/II/III = 0.75x/1x/1.5x; gear recipe is 1 s -> 45/60/90 per minute
    it.each([[65, 45], [66, 60], [67, 90]])('assembler model %i makes %f gears/min', (modelIndex, perMin) => {
        const r = analyzeMaterialFlow([{ itemId: 2303, modelIndex, recipeId: 5 }], gameEnv);
        expect(r.outputs).toEqual([{ itemId: 1201, perMin, recipeIds: [5] }]);
    });
    it('treats a smelter, a lab and the miners as expected', () => {
        expect(gameEnv.worker(194)).toEqual({ kind: 'craft', speed: 2 });
        expect(gameEnv.worker(70)).toEqual({ kind: 'craft', speed: 1 });
        expect(gameEnv.worker(57)).toEqual({ kind: 'mining' });
        expect(gameEnv.worker(256)).toEqual({ kind: 'mining' });
        expect(gameEnv.worker(35)).toBeNull();
    });
});
