import { tierOf as itemTier } from '@/analysis/facilities';
import { tierOf } from '@/render/core/tiers';
import { items } from '@/data/itemsData';

// 侧栏设施列表与 3D 视图的等级色必须一致（同一条规则）
test('3D tier colours follow the same rule as the sidebar for every item', () => {
    const mismatched = items.filter(i => tierOf(i.id) !== itemTier(i)).map(i => `${i.id} grade ${i.grade}`);
    expect(mismatched).toEqual([]);
});
