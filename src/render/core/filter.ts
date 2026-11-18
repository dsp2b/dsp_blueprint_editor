import { BlueprintBuilding } from '@/blueprint/parser';

/** 侧栏"点一下在视图里高亮"的过滤条件 */
export type HighlightFilter = { itemId: number } | { recipeId: number } | null;

export function matchesFilter(b: BlueprintBuilding, filter: Exclude<HighlightFilter, null>) {
    if ('itemId' in filter)
        return b.itemId === filter.itemId;
    return b.recipeId === filter.recipeId;
}

/** 返回每个建筑是否匹配（1/0）；没有过滤条件时为 null */
export function highlightMask(buildings: BlueprintBuilding[], filter: HighlightFilter) {
    if (filter === null)
        return null;
    const mask = new Uint8Array(buildings.length);
    for (const b of buildings)
        mask[b.index] = matchesFilter(b, filter) ? 1 : 0;
    return mask;
}
