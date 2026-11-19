import { analyzeMaterialFlow, recipeRates, FlowEnv, FlowRecipe, FlowBuilding, Worker } from '@/analysis/materialFlow';

const ORE = 1001, PLATE = 1101, GEAR = 1201;
const SMELTER = 2302, ASSEMBLER = 2303, MINER = 2301;

const recipes = new Map<number, FlowRecipe>([
    [1, { id: 1, time: 60, from: [{ itemId: ORE, count: 1 }], to: [{ itemId: PLATE, count: 1 }] }],
    [5, { id: 5, time: 60, from: [{ itemId: PLATE, count: 1 }], to: [{ itemId: GEAR, count: 1 }] }],
    [9, { id: 9, time: 90, from: [{ itemId: ORE, count: 1 }], to: [{ itemId: PLATE, count: 2 }] }],
]);
// model index -> worker; the model index equals the item id here for brevity
const workers = new Map<number, Worker>([
    [SMELTER, { kind: 'craft', speed: 1 }],
    [ASSEMBLER, { kind: 'craft', speed: 1 }],
    [20, { kind: 'craft', speed: 0.75 }],
    [30, { kind: 'craft', speed: 1.5 }],
    [MINER, { kind: 'mining' }],
]);
const env: FlowEnv = {
    recipe: id => recipes.get(id),
    worker: model => workers.get(model) ?? null,
};
const b = (itemId: number, recipeId = 0, modelIndex = itemId): FlowBuilding => ({ itemId, modelIndex, recipeId });
const line = <T extends { itemId: number }>(l: T[], id: number) => l.find(x => x.itemId === id);

describe('recipeRates', () => {
    it('is count * 3600 * speed / ticks per minute', () => {
        expect(recipeRates(recipes.get(1)!, 1).outputs).toEqual([{ itemId: PLATE, perMin: 60 }]);
        expect(recipeRates(recipes.get(9)!, 1).outputs).toEqual([{ itemId: PLATE, perMin: 80 }]);
        expect(recipeRates(recipes.get(9)!, 1).inputs).toEqual([{ itemId: ORE, perMin: 40 }]);
    });
    it('scales with the building speed', () => {
        expect(recipeRates(recipes.get(5)!, 0.75).outputs[0].perMin).toBeCloseTo(45);
        expect(recipeRates(recipes.get(5)!, 1.5).outputs[0].perMin).toBeCloseTo(90);
        expect(recipeRates(recipes.get(5)!, 2).inputs[0].perMin).toBeCloseTo(120);
    });
});

describe('analyzeMaterialFlow', () => {
    it('uses each building speed', () => {
        const r = analyzeMaterialFlow([b(ASSEMBLER, 5, 20), b(ASSEMBLER, 5, 30)], env);
        expect(line(r.outputs, GEAR)!.perMin).toBeCloseTo(45 + 90);
        expect(line(r.inputs, PLATE)!.perMin).toBeCloseTo(45 + 90);
    });

    it('classifies consumed-only as In and produced-only as Out', () => {
        const r = analyzeMaterialFlow([b(SMELTER, 1), b(ASSEMBLER, 5)], env);
        expect(r.inputs).toEqual([{ itemId: ORE, perMin: 60, recipeIds: [1] }]);
        expect(r.outputs).toEqual([{ itemId: GEAR, perMin: 60, recipeIds: [5] }]);
        expect(r.shortfalls).toEqual([]);
    });

    it('reports produced-and-consumed items as intermediates with supply and demand', () => {
        const r = analyzeMaterialFlow([b(SMELTER, 1), b(ASSEMBLER, 5)], env);
        expect(r.intermediates).toEqual([{ itemId: PLATE, supply: 60, demand: 60 }]);
        expect(line(r.inputs, PLATE)).toBeUndefined();
        expect(line(r.outputs, PLATE)).toBeUndefined();
    });

    it('warns with the deficit and the ceil of extra producing buildings', () => {
        // demand 45 + 90 = 135, supply 60 -> deficit 75, one smelter makes 60 -> 2 more
        const r = analyzeMaterialFlow([b(SMELTER, 1), b(ASSEMBLER, 5, 20), b(ASSEMBLER, 5, 30)], env);
        expect(r.shortfalls).toEqual([{
            itemId: PLATE, supply: 60, demand: 135, deficit: 75,
            producerItemId: SMELTER, perBuilding: 60, extraBuildings: 2,
        }]);
    });

    it('does not round an exact multiple up', () => {
        // demand 135, supply 45 (0.75x smelter) -> deficit 90 = exactly 2 * 45
        const slow = new Map(workers).set(21, { kind: 'craft', speed: 0.75 });
        const r = analyzeMaterialFlow(
            [b(SMELTER, 1, 21), b(ASSEMBLER, 5, 20), b(ASSEMBLER, 5, 30)],
            { recipe: env.recipe, worker: m => slow.get(m) ?? null });
        expect(r.shortfalls[0].deficit).toBeCloseTo(90);
        expect(r.shortfalls[0].extraBuildings).toBe(2);
    });

    it('lists a surplus intermediate for its supply/demand bar, without a warning', () => {
        const r = analyzeMaterialFlow([b(SMELTER, 1), b(SMELTER, 1), b(ASSEMBLER, 5)], env);
        expect(r.shortfalls).toEqual([]);
        expect(r.intermediates).toEqual([{ itemId: PLATE, supply: 120, demand: 60 }]);
        expect(r.surpluses).toEqual([{ itemId: PLATE, supply: 120, demand: 60 }]);
    });

    it('shows nothing for balanced intermediates', () => {
        const r = analyzeMaterialFlow([b(SMELTER, 1), b(ASSEMBLER, 5)], env);
        expect(r.shortfalls).toEqual([]);
        expect(r.surpluses).toEqual([]);
    });

    it('does not list a shortfall as a surplus', () => {
        const r = analyzeMaterialFlow([b(SMELTER, 1), b(ASSEMBLER, 5, 20), b(ASSEMBLER, 5, 30)], env);
        expect(r.surpluses).toEqual([]);
    });

    it('picks the producer type that supplies the most for the extra-building count', () => {
        // two recipes make plates: recipe 9 smelter (80/min) beats recipe 1 smelter at 0.75x (45/min)
        const r = analyzeMaterialFlow([b(SMELTER, 9), b(2315, 1, 20), b(ASSEMBLER, 5, 30), b(ASSEMBLER, 5, 30), b(ASSEMBLER, 5, 30)], env);
        // supply 80 + 45, demand 270 -> deficit 145, dominant producer: smelter recipe 9 group (80/min each)
        expect(r.shortfalls[0].producerItemId).toBe(SMELTER);
        expect(r.shortfalls[0].perBuilding).toBeCloseTo(80);
        expect(r.shortfalls[0].extraBuildings).toBe(2);
    });

    it('names every recipe that moves an In/Out item, most first (for highlighting)', () => {
        // two recipe-9 smelters move more ore and plates than one recipe-1 smelter
        const r = analyzeMaterialFlow([b(SMELTER, 9), b(SMELTER, 9), b(SMELTER, 1)], env);
        expect(line(r.inputs, ORE)).toEqual({ itemId: ORE, perMin: 140, recipeIds: [9, 1] });
        expect(line(r.outputs, PLATE)).toEqual({ itemId: PLATE, perMin: 220, recipeIds: [9, 1] });
    });

    it('excludes mining buildings and counts them', () => {
        const r = analyzeMaterialFlow([b(MINER), b(MINER), b(SMELTER, 1)], env);
        expect(r.mining.count).toBe(2);
        expect(line(r.outputs, ORE)).toBeUndefined();
        expect(r.inputs).toEqual([{ itemId: ORE, perMin: 60, recipeIds: [1] }]);
    });

    it('ignores buildings without a known recipe or worker', () => {
        const r = analyzeMaterialFlow([b(ASSEMBLER, 0), b(ASSEMBLER, 999), b(7777, 1)], env);
        expect(r).toEqual({ inputs: [], outputs: [], intermediates: [], shortfalls: [], surpluses: [], mining: { count: 0 } });
    });
});
