<template>
    <div v-if="building === null" class="empty-detail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l7 16 2-7 7-2z"/></svg>
        <p>{{ t('点一个建筑') }}</p>
    </div>
    <BuildingInfoPanel v-else :key="building.index" :building="building" />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { BlueprintBuilding } from '@/blueprint/parser';
import BuildingInfoPanel from '../BuildingInfoPanel.vue';

defineProps<{ building: BlueprintBuilding | null }>();
const { t } = useI18n();
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
