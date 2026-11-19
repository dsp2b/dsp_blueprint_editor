import type { BlueprintBuilding } from '@/blueprint/parser';

export interface ConnectionSummary {
    inCount: number;
    outCount: number;
    items: { itemId: number; count: number }[];
}

/** 相邻建筑里谁把东西送进来（输入），谁从这里取走（输出） */
export function connectionSummary(b: BlueprintBuilding, adjacency: BlueprintBuilding[][]): ConnectionSummary {
    const items = new Map<number, number>();
    let inCount = 0, outCount = 0;
    for (const n of adjacency[b.index] ?? []) {
        if (!n)
            continue;
        // n 输出到 b，或 b 从 n 取货（分拣器的来源不会反向指向分拣器）
        if (n.outputObjIdx === b.index || b.inputObjIdx === n.index)
            inCount++;
        else
            outCount++;
        items.set(n.itemId, (items.get(n.itemId) ?? 0) + 1);
    }
    return { inCount, outCount, items: [...items].map(([itemId, count]) => ({ itemId, count })) };
}
