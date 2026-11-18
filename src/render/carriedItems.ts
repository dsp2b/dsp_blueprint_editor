import { BlueprintBuilding, BlueprintData, IODir, StationParameters } from '@/blueprint/parser';
import { isBelt, isInserter } from '@/data/items';
import { recipesMap } from '@/data/recipes';

/** 配方的（第一个）产物；没有该配方时为 undefined */
export type RecipeOutput = (recipeId: number) => number | undefined;

const gameRecipeOutput: RecipeOutput = id => recipesMap.get(id)?.to[0]?.item.id;

function stationParams(b: BlueprintBuilding): StationParameters | null {
    const p = b.parameters as Partial<StationParameters> | null;
    return p && Array.isArray(p.slots) && Array.isArray(p.storage) ? p as StationParameters : null;
}

/** 物流站（含大型采矿机）某个槽位设定的物品：槽位方向要与连接方向一致 */
function slotItem(b: BlueprintBuilding, slot: number, dir: IODir) {
    const p = stationParams(b);
    const s = p?.slots[slot];
    if (!p || !s || s.dir !== dir || s.storageIdx <= 0)
        return 0;
    return p.storage[s.storageIdx - 1]?.itemId ?? 0;
}

/**
 * 推断蓝图里每条传送带、每个分拣器运送的物品，返回 建筑 index -> 物品 id（推断不出的不在结果里）。
 * 依据（先到先得）：
 * 1. 来自上游：分拣器的过滤物品，否则它取货的建筑的配方产物；物流站输出槽位设定的物品；
 *    这些沿分拣器放货、传送带输出的方向往下游传，分拣器从带上取货时得到带上的物品。
 * 2. 上游推断不出的带再看下游：流进物流站输入槽位的物品、带过滤的分拣器从带上取的物品，沿带往上游传。
 */
export function inferCarriedItems(
    bp: Pick<BlueprintData, 'buildings'>,
    recipeOutput: RecipeOutput = gameRecipeOutput,
): Map<number, number> {
    const byIndex = new Map<number, BlueprintBuilding>();
    for (const b of bp.buildings)
        byIndex.set(b.index, b);
    const belts = bp.buildings.filter(b => isBelt(b.itemId));
    const sorters = bp.buildings.filter(b => isInserter(b.itemId));
    const isBeltAt = (index: number) => {
        const b = byIndex.get(index);
        return b !== undefined && isBelt(b.itemId);
    };

    /** 往某条带上送货的带与分拣器 */
    const feeders = new Map<number, BlueprintBuilding[]>();
    /** 从某条带上取货、带过滤的分拣器 */
    const filteredPickers = new Map<number, BlueprintBuilding[]>();
    for (const b of [...belts, ...sorters]) {
        if (b.outputObjIdx !== b.index && isBeltAt(b.outputObjIdx))
            feeders.set(b.outputObjIdx, [...feeders.get(b.outputObjIdx) ?? [], b]);
        if (isInserter(b.itemId) && b.filterId > 0 && isBeltAt(b.inputObjIdx))
            filteredPickers.set(b.inputObjIdx, [...filteredPickers.get(b.inputObjIdx) ?? [], b]);
    }

    const items = new Map<number, number>();
    let changed = false;
    const set = (b: BlueprintBuilding, itemId: number | undefined) => {
        if (itemId && itemId > 0 && !items.has(b.index)) {
            items.set(b.index, itemId);
            changed = true;
        }
    };
    /** 建筑（非传送带/分拣器/物流站）当前配方的产物 */
    const producerOutput = (b: BlueprintBuilding | undefined) => {
        if (!b || isBelt(b.itemId) || isInserter(b.itemId) || stationParams(b) || b.recipeId <= 0)
            return undefined;
        return recipeOutput(b.recipeId);
    };

    for (const s of sorters)
        set(s, s.filterId > 0 ? s.filterId : producerOutput(byIndex.get(s.inputObjIdx)));

    const supply = () => {
        do {
            changed = false;
            for (const b of belts) {
                if (items.has(b.index))
                    continue;
                const src = byIndex.get(b.inputObjIdx);
                if (src)
                    set(b, stationParams(src) ? slotItem(src, b.inputFromSlot, IODir.Output) : producerOutput(src));
                for (const f of feeders.get(b.index) ?? [])
                    set(b, items.get(f.index));
            }
            for (const s of sorters) {
                if (!items.has(s.index) && isBeltAt(s.inputObjIdx))
                    set(s, items.get(s.inputObjIdx));
            }
        } while (changed);
    };

    // 下游推断只沿"由下游推断出的"带往上游传，不把上游来的物品倒灌给汇入的支线
    const fromDemand = new Set<number>();
    let demandChanged: boolean;
    do {
        supply();
        demandChanged = false;
        for (const b of belts) {
            if (items.has(b.index))
                continue;
            const dst = byIndex.get(b.outputObjIdx);
            let itemId = 0;
            if (dst && stationParams(dst))
                itemId = slotItem(dst, b.outputToSlot, IODir.Input);
            else if (dst && fromDemand.has(dst.index))
                itemId = items.get(dst.index) ?? 0;
            itemId = itemId || (filteredPickers.get(b.index)?.[0]?.filterId ?? 0);
            if (itemId > 0) {
                items.set(b.index, itemId);
                fromDemand.add(b.index);
                demandChanged = true;
            }
        }
    } while (demandChanged);
    return items;
}
