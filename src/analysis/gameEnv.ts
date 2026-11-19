import { buildingMeta } from '@/data/building';
import { recipesMap } from '@/data/recipes';
import type { FlowEnv, FlowRecipe, Worker } from './materialFlow';

/** PrefabDesc raw numbers: assemblerSpeed / labSpeed 10000 = 1x (Mk.I assembler 7500 = 0.75x). */
const SPEED_UNIT = 10000;

const toFlowRecipe = new Map<number, FlowRecipe>();

/** FlowEnv backed by the generated game data. */
export const gameEnv: FlowEnv = {
    recipe(id) {
        let r = toFlowRecipe.get(id);
        if (!r) {
            const src = recipesMap.get(id);
            if (!src)
                return undefined;
            r = {
                id, time: src.time,
                from: src.from.map(s => ({ itemId: s.item.id, count: s.count })),
                to: src.to.map(s => ({ itemId: s.item.id, count: s.count })),
            };
            toFlowRecipe.set(id, r);
        }
        return r;
    },
    worker(modelIndex): Worker | null {
        const work = buildingMeta.get(modelIndex)?.work;
        if (!work)
            return null;
        if (work.minerSpeed !== undefined)
            return { kind: 'mining' };
        const speed = work.assemblerSpeed ?? work.labSpeed;
        return speed === undefined ? null : { kind: 'craft', speed: speed / SPEED_UNIT };
    },
};
