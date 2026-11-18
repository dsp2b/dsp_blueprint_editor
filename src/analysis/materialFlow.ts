/**
 * Theoretical full-speed material flow of a blueprint.
 * Pure: no Vue, no src/define.ts; game data comes in through FlowEnv (see gameEnv.ts for the real one).
 */

/** time is in ticks (1/60 s), as in src/data/types.ts Recipe */
export interface FlowRecipe {
    id: number;
    time: number;
    from: { itemId: number; count: number }[];
    to: { itemId: number; count: number }[];
}

/** craft: speed is a multiplier (1 = recipe time as written); mining: output depends on the vein */
export type Worker = { kind: 'craft'; speed: number } | { kind: 'mining' };

export interface FlowEnv {
    recipe(recipeId: number): FlowRecipe | undefined;
    worker(modelIndex: number): Worker | null;
}

export interface FlowBuilding {
    itemId: number;
    modelIndex: number;
    recipeId: number;
}

/** recipeId: the recipe that moves most of this item, so the UI can highlight it in the view */
export interface FlowLine { itemId: number; perMin: number; recipeId: number }
export interface Balance { itemId: number; supply: number; demand: number }
export interface Shortfall extends Balance {
    deficit: number;
    /** building item that produces most of the supply */
    producerItemId: number;
    /** per-minute output of one such building (average over the group) */
    perBuilding: number;
    extraBuildings: number;
}
export interface MaterialFlow {
    inputs: FlowLine[];
    outputs: FlowLine[];
    intermediates: Balance[];
    shortfalls: Shortfall[];
    mining: { count: number };
}

/** Absorbs floating point noise before rounding up / comparing */
const EPS = 1e-9;

/** Per-minute rates of one building running the recipe at full speed (proliferator not counted). */
export function recipeRates(recipe: FlowRecipe, speed: number) {
    // crafts per minute = 60 / (seconds per craft / speed) with seconds = ticks / 60
    const crafts = recipe.time > 0 ? 3600 * speed / recipe.time : 0;
    return {
        inputs: recipe.from.map(s => ({ itemId: s.itemId, perMin: s.count * crafts })),
        outputs: recipe.to.map(s => ({ itemId: s.itemId, perMin: s.count * crafts })),
    };
}

export function analyzeMaterialFlow(buildings: FlowBuilding[], env: FlowEnv): MaterialFlow {
    const supply = new Map<number, number>();
    const demand = new Map<number, number>();
    // item -> producing building item -> { total per minute, buildings }
    const producers = new Map<number, Map<number, { perMin: number; count: number }>>();
    // item -> recipe -> per minute, for the dominant recipe of In/Out lines
    const supplyBy = new Map<number, Map<number, number>>();
    const demandBy = new Map<number, Map<number, number>>();
    let mining = 0;
    const add = (m: Map<number, number>, id: number, v: number) => m.set(id, (m.get(id) ?? 0) + v);
    const addBy = (m: Map<number, Map<number, number>>, id: number, recipeId: number, v: number) => {
        let inner = m.get(id);
        if (!inner)
            m.set(id, inner = new Map());
        add(inner, recipeId, v);
    };
    const dominant = (m: Map<number, Map<number, number>>, id: number) => {
        let best = 0, bestV = -1;
        for (const [r, v] of m.get(id)!)
            if (v > bestV)
                [best, bestV] = [r, v];
        return best;
    };

    for (const b of buildings) {
        const worker = env.worker(b.modelIndex);
        if (worker === null)
            continue;
        if (worker.kind === 'mining') {
            mining++;
            continue;
        }
        const recipe = b.recipeId > 0 ? env.recipe(b.recipeId) : undefined;
        if (!recipe || recipe.time <= 0)
            continue;
        const rates = recipeRates(recipe, worker.speed);
        for (const l of rates.inputs)
            add(demand, l.itemId, l.perMin), addBy(demandBy, l.itemId, recipe.id, l.perMin);
        for (const l of rates.outputs) {
            add(supply, l.itemId, l.perMin);
            addBy(supplyBy, l.itemId, recipe.id, l.perMin);
            let byBuilding = producers.get(l.itemId);
            if (!byBuilding)
                producers.set(l.itemId, byBuilding = new Map());
            const g = byBuilding.get(b.itemId) ?? { perMin: 0, count: 0 };
            g.perMin += l.perMin;
            g.count++;
            byBuilding.set(b.itemId, g);
        }
    }

    const byRate = (a: FlowLine, b: FlowLine) => b.perMin - a.perMin || a.itemId - b.itemId;
    const inputs: FlowLine[] = [];
    const outputs: FlowLine[] = [];
    const intermediates: Balance[] = [];
    const shortfalls: Shortfall[] = [];

    for (const [itemId, d] of demand)
        if (!supply.has(itemId))
            inputs.push({ itemId, perMin: d, recipeId: dominant(demandBy, itemId) });
    for (const [itemId, s] of supply) {
        const d = demand.get(itemId);
        if (d === undefined) {
            outputs.push({ itemId, perMin: s, recipeId: dominant(supplyBy, itemId) });
            continue;
        }
        intermediates.push({ itemId, supply: s, demand: d });
        if (s >= d - EPS)
            continue;
        let best: { itemId: number; perMin: number; count: number } | null = null;
        for (const [buildingItem, g] of producers.get(itemId)!)
            if (!best || g.perMin > best.perMin)
                best = { itemId: buildingItem, ...g };
        const perBuilding = best!.perMin / best!.count;
        const deficit = d - s;
        shortfalls.push({
            itemId, supply: s, demand: d, deficit,
            producerItemId: best!.itemId, perBuilding,
            extraBuildings: Math.ceil(deficit / perBuilding - EPS),
        });
    }

    inputs.sort(byRate);
    outputs.sort(byRate);
    intermediates.sort((a, b) => b.demand - a.demand || a.itemId - b.itemId);
    shortfalls.sort((a, b) => b.deficit - a.deficit || a.itemId - b.itemId);
    return { inputs, outputs, intermediates, shortfalls, mining: { count: mining } };
}
