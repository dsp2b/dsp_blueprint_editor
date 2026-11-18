<template>
    <div v-if="empty" class="flow-empty">{{ t('没有生产建筑') }}</div>
    <template v-else>
        <div class="flow">
            <div class="flow-col">
                <div class="flow-head">{{ t('运入') }}</div>
                <ul class="list compact">
                    <li v-for="l of flow.inputs" :key="l.itemId">
                        <button type="button" class="row" :class="{ hl: active === key(l) }" :aria-pressed="active === key(l)"
                                @click="emit('toggle', { recipeId: l.recipeId }, key(l))">
                            <BuildingIcon :icon-id="itemIconId(l.itemId)" alt="" />
                            <span class="name">{{ itemName(l.itemId) }}</span>
                            <span class="num">{{ fmt(l.perMin) }}</span>
                        </button>
                    </li>
                    <li v-if="!flow.inputs.length" class="none">{{ t('无') }}</li>
                </ul>
            </div>
            <div class="flow-col">
                <div class="flow-head">{{ t('运出') }}</div>
                <ul class="list compact">
                    <li v-for="l of flow.outputs" :key="l.itemId">
                        <button type="button" class="row" :class="{ hl: active === key(l) }" :aria-pressed="active === key(l)"
                                @click="emit('toggle', { recipeId: l.recipeId }, key(l))">
                            <BuildingIcon :icon-id="itemIconId(l.itemId)" alt="" />
                            <span class="name">{{ itemName(l.itemId) }}</span>
                            <span class="num">{{ fmt(l.perMin) }}</span>
                        </button>
                    </li>
                    <li v-if="!flow.outputs.length" class="none">{{ t('无') }}</li>
                </ul>
            </div>
        </div>
        <p class="note">{{ t('未计增产剂') }}<template v-if="flow.mining.count">{{ t('采矿说明', { n: flow.mining.count }) }}</template></p>

        <div v-if="flow.shortfalls.length" class="balance" role="note">
            <div class="balance-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>
                {{ t('产能不够标题') }}
            </div>
            <div v-for="s of flow.shortfalls" :key="s.itemId" class="short">
                <div class="bar-row">
                    <BuildingIcon :icon-id="itemIconId(s.itemId)" alt="" />
                    <span>{{ itemName(s.itemId) }}</span>
                    <div class="bar" role="img" :aria-label="t('供应占需求', { pct: Math.floor(s.supply / s.demand * 100) })"><i :style="{ width: Math.max(2, s.supply / s.demand * 100) + '%' }"></i></div>
                    <span class="bar-num">{{ fmt(s.supply) }} / {{ fmt(s.demand) }}</span>
                </div>
                <p>{{ t('缺口建议', { amount: fmt(s.deficit), n: s.extraBuildings, building: itemName(s.producerItemId) }) }}</p>
            </div>
        </div>
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FlowLine, MaterialFlow } from '@/analysis/materialFlow';
import type { HighlightFilter } from '@/render/core/filter';
import { itemIconId } from '@/data/icons';
import { itemName } from '@/i18n';
import BuildingIcon from '../BuildingIcon.vue';

const props = defineProps<{ flow: MaterialFlow, active: string | null }>();
const emit = defineEmits<{ (e: 'toggle', filter: Exclude<HighlightFilter, null>, key: string): void }>();
const { t } = useI18n();

const empty = computed(() => !props.flow.inputs.length && !props.flow.outputs.length
    && !props.flow.intermediates.length && !props.flow.mining.count);
const key = (l: FlowLine) => `recipe:${l.recipeId}`;
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
</script>

<style lang="scss" scoped>
.flow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.flow-col { min-width: 0; padding: 8px 10px 4px; border: 1px solid var(--line); border-radius: 10px; }
.flow-head { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.flow-empty, .note, .none { font-size: 12.5px; color: var(--muted); }
.note { margin: 6px 0 0; }
.list { margin: 0; padding: 0; list-style: none; }
.row {
    display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; align-items: center;
    width: calc(100% + 12px); margin: 0 -6px; padding: 5px 6px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
    &:hover, &.hl { background: var(--panel-2); }
    &.hl { box-shadow: inset 2px 0 0 var(--holo); }
    :deep(.icon) { width: 26px; height: 26px; }
}
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { font: 600 15px var(--num); }
.balance { margin-top: 10px; padding: 12px; border-radius: 10px; background: rgba(227, 162, 99, .08); border: 1px solid rgba(227, 162, 99, .35); }
.balance-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #F2C38F; margin-bottom: 8px; }
.bar-row { display: grid; grid-template-columns: 22px minmax(36px, auto) 1fr auto; gap: 8px; align-items: center; font-size: 12.5px; margin: 6px 0 0; :deep(.icon) { width: 22px; height: 22px; } }
.bar { height: 6px; border-radius: 3px; background: var(--panel-3); overflow: hidden; i { display: block; height: 100%; background: var(--mk1); } }
.bar-num { font: 12.5px var(--num); color: var(--muted); }
.short p { margin: 4px 0 10px; font-size: 12.5px; color: var(--muted); }
.short:last-child p { margin-bottom: 0; }
</style>

<i18n>
{
    "zh": {
        "没有生产建筑": "蓝图里没有设置了配方的生产建筑，没有物料流可统计。",
        "运入": "运入",
        "运出": "运出",
        "无": "无",
        "未计增产剂": "按满速理论值计算，未计入增产剂。",
        "采矿说明": "另有 {n} 台采矿设备，产量取决于矿脉，未计入。",
        "产能不够标题": "上游产能不够，下游设备跑不满",
        "供应占需求": "供应达到需求的 {pct}%",
        "缺口建议": "每分钟缺 {amount}，再加 {n} 台{building}可满速运行。"
    },
    "en": {
        "没有生产建筑": "No production building has a recipe set in this blueprint, so there is no material flow to show.",
        "运入": "In",
        "运出": "Out",
        "无": "None",
        "未计增产剂": "Theoretical full speed, proliferator not included.",
        "采矿说明": " {n} mining building(s) are left out because their output depends on the vein.",
        "产能不够标题": "Some inputs are short, so machines downstream cannot run at full speed",
        "供应占需求": "Supply is {pct}% of demand",
        "缺口建议": "Short by {amount} per minute. Add {n} more {building} to run at full speed."
    }
}
</i18n>
