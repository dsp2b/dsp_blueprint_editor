<template>
    <div class="building-params">
        <div><label>{{ t('颜色') }}</label><span class="v"><ColorPreview :color-id="p.color" /></span></div>
        <div><label>{{ t('高度') }}</label><span class="v">{{ p.height }}</span></div>
        <div><label>{{ t('半径') }}</label><span class="v">{{ p.radius }}</span></div>
        <div><label>{{ t('可见性') }}</label><span class="v">{{ p.visibility }}</span></div>
        <div><label>{{ t('细节等级') }}</label><span class="v">{{ p.detailLevel }}</span></div>
        <div>
            <label>{{ t('图标') }}</label>
            <span class="v"><BuildingIcon v-if="p.icon > 0" :icon-id="p.icon" /><span v-else>{{ t('无') }}</span></span>
        </div>
        <div>
            <label>{{ t('信号') }}</label>
            <span class="v"><BuildingIcon v-if="p.digitalSignalId > 0" :icon-id="p.digitalSignalId" /><span v-else>{{ t('无') }}</span></span>
        </div>
        <div v-if="text.word"><label>{{ t('标记词') }}</label><span class="v marker-text">{{ text.word }}</span></div>
        <div v-if="text.tags"><label>{{ t('标签') }}</label><span class="v marker-text">{{ text.tags }}</span></div>
        <div v-if="text.name"><label>{{ t('名称') }}</label><span class="v marker-text">{{ text.name }}</span></div>
        <div v-if="text.comment"><label>{{ t('注释') }}</label><span class="v marker-text">{{ text.comment }}</span></div>
    </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { BlueprintBuilding, MarkerParameters, parseMarkerContent } from '@/blueprint/parser';
import BuildingIcon from './BuildingIcon.vue';
import ColorPreview from './ColorPreview.vue';

const { t } = useI18n();

const props = defineProps<{
    building: BlueprintBuilding,
}>();

const p = computed(() => props.building.parameters as MarkerParameters);
const text = computed(() => parseMarkerContent(props.building.content ?? ''));
</script>

<style lang="scss">
.marker-text {
    white-space: pre-wrap;
    word-break: break-all;
}
</style>

<i18n>
{
    "zh": {
        "颜色": "颜色",
        "高度": "高度",
        "半径": "半径",
        "可见性": "可见性",
        "细节等级": "细节等级",
        "图标": "图标",
        "信号": "信号",
        "无": "无",
        "标记词": "标记词",
        "标签": "标签",
        "名称": "名称",
        "注释": "注释"
    },
    "en": {
        "颜色": "Color",
        "高度": "Height",
        "半径": "Radius",
        "可见性": "Visibility",
        "细节等级": "Detail level",
        "图标": "Icon",
        "信号": "Signal",
        "无": "None",
        "标记词": "Word",
        "标签": "Tags",
        "名称": "Name",
        "注释": "Comment"
    }
}
</i18n>
