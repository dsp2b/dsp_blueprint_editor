<template>
    <template v-for="g of groups" :key="g.group">
        <div class="group-label">{{ t(g.group) }}</div>
        <ul class="list">
            <li v-for="f of g.rows" :key="f.itemId">
                <button type="button" class="row" :class="{ hl: active === `item:${f.itemId}` }"
                        :aria-pressed="active === `item:${f.itemId}`"
                        @click="emit('toggle', { itemId: f.itemId }, `item:${f.itemId}`)">
                    <BuildingIcon :icon-id="itemIconId(f.itemId)" alt="" />
                    <span class="name">
                        <span v-if="f.tier" class="tier" :style="{ background: `var(--mk${f.tier})` }" aria-hidden="true"></span>{{ itemName(f.itemId) }}
                    </span>
                    <span class="num">{{ f.count }}</span>
                </button>
            </li>
        </ul>
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BlueprintBuilding } from '@/blueprint/parser';
import { facilityGroup, facilityGroups, tierOf } from '@/analysis/facilities';
import type { FacilityGroup } from '@/analysis/facilities';
import { itemsMap } from '@/data';
import { itemIconId } from '@/data/icons';
import { itemName } from '@/i18n';
import type { HighlightFilter } from '@/render/core/filter';
import BuildingIcon from '../BuildingIcon.vue';

const props = defineProps<{ buildings: BlueprintBuilding[], active: string | null }>();
const emit = defineEmits<{ (e: 'toggle', filter: Exclude<HighlightFilter, null>, key: string): void }>();
const { t } = useI18n();

const groups = computed(() => {
    const counts = new Map<number, number>();
    for (const b of props.buildings)
        counts.set(b.itemId, (counts.get(b.itemId) ?? 0) + 1);
    const byGroup = new Map<FacilityGroup, { itemId: number, count: number, tier: 1 | 2 | 3 | null, order: number }[]>();
    for (const [itemId, count] of counts) {
        const item = itemsMap.get(itemId);
        const group = facilityGroup(item?.buildIndex ?? 0);
        const rows = byGroup.get(group) ?? [];
        rows.push({ itemId, count, tier: item ? tierOf(item) : null, order: item?.buildIndex || Infinity });
        byGroup.set(group, rows);
    }
    return facilityGroups
        .filter(g => byGroup.has(g))
        .map(group => ({ group, rows: byGroup.get(group)!.sort((a, b) => a.order - b.order || a.itemId - b.itemId) }));
});
</script>

<style lang="scss" scoped>
.group-label { margin: 10px 0 2px; font-size: 12px; color: var(--faint); }
.list { margin: 0; padding: 0; list-style: none; }
.row {
    display: grid; grid-template-columns: 32px 1fr auto; gap: 10px; align-items: center;
    width: calc(100% + 16px); margin: 0 -8px; padding: 7px 8px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
    &:hover, &.hl { background: var(--panel-2); }
    &.hl { box-shadow: inset 2px 0 0 var(--holo); }
    :deep(.icon) { width: 32px; height: 32px; }
}
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tier { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: 1px; }
.num { font: 600 16px var(--num); text-align: right; }
</style>

<i18n>
{
    "zh": { "production": "生产", "logistics": "物流", "power": "电力", "defence": "防御", "other": "其他" },
    "en": { "production": "Production", "logistics": "Logistics", "power": "Power", "defence": "Defence", "other": "Other" }
}
</i18n>
