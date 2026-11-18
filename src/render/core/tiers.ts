import { Color } from 'three';
import { itemsMap } from '@/data/items';

export type Tier = 1 | 2 | 3;

/** 图例与描边用的等级色（与 theme.scss 的 --mk1/2/3 一致） */
export const TIER_HEX: Record<Tier, number> = { 1: 0xE3A263, 2: 0x51A896, 3: 0x61A5D7 };
export const TIER_COLORS: Record<Tier, Color> = {
    1: new Color(TIER_HEX[1]),
    2: new Color(TIER_HEX[2]),
    3: new Color(TIER_HEX[3]),
};

/** 有升级链的建筑按 Grade 给出 Mk.I/II/III；没有等级或超出三级的返回 null */
export function tierOf(itemId: number): Tier | null {
    const item = itemsMap.get(itemId);
    const grade = item?.grade ?? 0;
    if ((item?.upgrades?.length ?? 0) < 2)
        return null;
    return grade >= 1 && grade <= 3 ? grade as Tier : null;
}
