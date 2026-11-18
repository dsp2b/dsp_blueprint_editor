<template>
    <div class="stats">
        <div><b>{{ buildings.length }}</b><span>{{ t('建筑') }}</span></div>
        <div>
            <b v-if="footprint.width !== null">{{ footprint.width }}<small>×</small>{{ footprint.height }}</b>
            <b v-else>{{ footprint.cells }}</b>
            <span>{{ t('占地') }}</span>
        </div>
        <div><b>{{ data.areas.length }}</b><span>{{ t('区域') }}</span></div>
    </div>

    <h3>{{ t('物料流标题') }}</h3>
    <MaterialFlow :flow="flow" :active="active" @toggle="toggle" />

    <h3>{{ t('包含设施') }} <span class="hint">{{ t('点一下高亮') }}</span></h3>
    <FacilityList :buildings="buildings" :active="active" @toggle="toggle" />
</template>

<script setup lang="ts">
import { computed, inject, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BlueprintData } from '@/blueprint/parser';
import { footprintCells } from '@/analysis/facilities';
import { analyzeMaterialFlow } from '@/analysis/materialFlow';
import { gameEnv } from '@/analysis/gameEnv';
import { commandQueueKey, rendererKey } from '@/define';
import type { HighlightFilter } from '@/render/core/filter';
import MaterialFlow from './MaterialFlow.vue';
import FacilityList from './FacilityList.vue';

const props = defineProps<{ data: BlueprintData }>();
const { t } = useI18n();

const queue = inject(commandQueueKey)!.value;
const renderer = inject(rendererKey, ref(null));

const buildings = computed(() => props.data.buildings);
const footprint = computed(() => footprintCells(props.data.areas));
const flow = computed(() => {
    queue?.execVersion.value; // 改配方等编辑（含撤销）后重新统计；建筑对象本身不是响应式的
    return analyzeMaterialFlow(buildings.value, gameEnv);
});

/** 当前在 3D 视图里高亮的行（再点一次取消） */
const active = ref<string | null>(null);
const toggle = (filter: Exclude<HighlightFilter, null>, key: string) => {
    active.value = active.value === key ? null : key;
    renderer.value?.highlight(active.value === null ? null : filter);
};
onUnmounted(() => { if (active.value !== null) renderer.value?.highlight(null); });
</script>

<style lang="scss" scoped>
.stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
    div { padding: 10px 12px; }
    div + div { border-left: 1px solid var(--line); }
    b { display: block; font: 600 22px/1.15 var(--num); }
    b small { font-size: 13px; color: var(--muted); font-weight: 400; margin: 0 2px; }
    span { font-size: 12px; color: var(--muted); }
}
.hint { font-weight: 400; color: var(--faint); }
</style>

<i18n>
{
    "zh": {
        "建筑": "建筑",
        "占地": "占地（格）",
        "区域": "区域",
        "物料流标题": "物料流（理论满速，每分钟）",
        "包含设施": "包含设施",
        "点一下高亮": "点一下在视图里高亮"
    },
    "en": {
        "建筑": "Buildings",
        "占地": "Footprint (cells)",
        "区域": "Areas",
        "物料流标题": "Material flow (full speed, per minute)",
        "包含设施": "Facilities",
        "点一下高亮": "click to highlight in the view"
    }
}
</i18n>
