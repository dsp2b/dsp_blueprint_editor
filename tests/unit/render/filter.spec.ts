import { BlueprintBuilding } from '@/blueprint/parser';
import { highlightMask } from '@/render/core/filter';

const b = (index: number, itemId: number, recipeId: number) => ({ index, itemId, recipeId } as BlueprintBuilding);

describe('highlightMask', () => {
    const buildings = [b(0, 2302, 1), b(1, 2302, 9), b(2, 2303, 5), b(3, 2303, 1)];
    it('is null without a filter', () => {
        expect(highlightMask(buildings, null)).toBeNull();
    });
    it('matches by building item', () => {
        expect([...highlightMask(buildings, { itemId: 2303 })!]).toEqual([0, 0, 1, 1]);
    });
    it('matches every building running one of the recipes of a material row', () => {
        expect([...highlightMask(buildings, { recipeIds: [9, 1] })!]).toEqual([1, 1, 0, 1]);
    });
});
