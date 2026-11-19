/** Pure helpers for the Overview facility list. */

export type FacilityGroup = 'production' | 'logistics' | 'power' | 'defence' | 'other';
export const facilityGroups: FacilityGroup[] = ['production', 'logistics', 'power', 'defence', 'other'];

/**
 * Item.buildIndex is the game's build-bar slot: hundreds digit = row, the rest = column.
 * Rows 3/4/6 (belts, sorters, storage, stations) are logistics, 1 power, 2 and 5 production
 * (miners, smelters, assemblers, refineries...), 7 defence, 9 other (foundation, beacon).
 * Row 8 mixes everything that did not fit earlier, so single slots are listed:
 * 801 lab / 802 ejector / 804 silo / 806 lab Mk.II / 807 smelter Mk.III / 808 assembler Mk.IV are production,
 * 803 ray receiver / 805 artificial star are power. Row 6 has the energy exchanger (606), which is power.
 * Items without a slot (buildIndex 0) are other.
 */
export function facilityGroup(buildIndex: number): FacilityGroup {
    const row = Math.floor(buildIndex / 100);
    switch (row) {
        case 1: return 'power';
        case 2: case 5: return 'production';
        case 3: case 4: return 'logistics';
        case 6: return buildIndex === 606 ? 'power' : 'logistics';
        case 7: return 'defence';
        case 8: return buildIndex === 803 || buildIndex === 805 ? 'power' : 'production';
        default: return 'other';
    }
}

/** 1..3 for the Mk.I/II/III colours; higher grades share the top colour. null when the item has no upgrade line. */
export function tierOf(item: { grade?: number; upgrades?: number[] }): 1 | 2 | 3 | null {
    if (!item.grade || !item.upgrades || item.upgrades.length < 2)
        return null;
    return Math.min(item.grade, 3) as 1 | 2 | 3;
}

/** Grid cells covered by the areas: width x height for a single area, only the total for several. */
export function footprintCells(areas: { size: { x: number; y: number } }[]) {
    const cells = areas.reduce((n, a) => n + a.size.x * a.size.y, 0);
    if (areas.length === 1)
        return { width: areas[0].size.x, height: areas[0].size.y, cells };
    return { width: null, height: null, cells };
}
