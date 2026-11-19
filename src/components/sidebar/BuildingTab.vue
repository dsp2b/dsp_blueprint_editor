<template>
    <div v-if="building === null" class="empty-detail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l7 16 2-7 7-2z"/></svg>
        <p>{{ t('点一个建筑') }}</p>
    </div>
    <template v-else>
        <BuildingInfoPanel :key="`${building.index}:${recipeId}`" :building="building" />
        <ProductionDetail :key="building.index" :building="building" />
    </template>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BlueprintBuilding } from '@/blueprint/parser';
import { commandQueueKey } from '@/define';
import BuildingInfoPanel from '../BuildingInfoPanel.vue';
import ProductionDetail from './ProductionDetail.vue';

const props = defineProps<{ building: BlueprintBuilding | null }>();
const { t } = useI18n();

const queue = inject(commandQueueKey)!.value;
// 换配方后让参数面板里的配方图标刷新（建筑对象本身不是响应式的）
const recipeId = computed(() => {
    void queue?.execVersion.value;
    return props.building?.recipeId;
});
</script>

<style lang="scss" scoped>
.empty-detail {
    padding: 28px 8px;
    text-align: center;
    color: var(--muted);
    svg { width: 40px; height: 40px; color: var(--faint); margin-bottom: 8px; }
    p { margin: 0; }
}
</style>

<i18n>
{
    "zh": {
        "点一个建筑": "在视图里点一个建筑，这里会显示它的配方和参数。"
    },
    "en": {
        "点一个建筑": "Click a building in the view to see its recipe and settings here."
    }
}
</i18n>
