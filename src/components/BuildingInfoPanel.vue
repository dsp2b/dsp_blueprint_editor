<template>
    <div class="detail-head">
        <BuildingIcon :icon-id="itemIconId(building.itemId)" alt="" />
        <div>
            <h3 class="detail-name">{{ t(buildingItem.name) }}</h3>
            <p>#{{ building.index }} <span>{{ t('位置') }} ({{ position }})</span></p>
        </div>
    </div>
    <BuildingRecipe v-if="building.recipeId > 0" :recipeId="building.recipeId" />

    <!-- 参数块为空（parameters === null）时不显示任何依赖参数的内容 -->
    <template v-if="bParams">
        <SplitterInfo v-if="isSplitter(building.itemId)" :building="building" />
        <StationInfo v-if="isStation(building.itemId)" :building="building" />
        <StationInfo v-if="isOrbitalCollector(building.itemId) && !(bParams as CollectorParameters).allZero" :building="building" />
        <MarkerInfo v-if="isMarker(building.itemId)" :building="building" />
        <MonitorInfo v-if="isMonitor(building.itemId)" :building="building" />
        <BattleBaseInfo v-if="isBattleBase(building.itemId)" :building="building" />
        <StorageInfo v-if="isStorage(building.itemId)" :building="building" />
    </template>
    <div class="building-params">
        <div v-if="filterItem">
            <label>{{ t('过滤器') }}</label>
            <span class="v" style="align-self: center;"><BuildingIcon :icon-id="itemIconId(filterItem.id)" :alt="t(filterItem.name)" /></span>
        </div>
        <div v-if="bParams && isLab(building.itemId)">
            <label>{{ t('模式') }}</label>
            <span class="v">{{ LabModeText }}</span>
        </div>
        <div v-if="accModeText !== undefined">
            <label>{{ t('增产剂效果简') }}</label>
            <span class="v">{{ accModeText }}</span>
        </div>
        <div v-if="bParams && isInserter(building.itemId)">
            <label>{{ t('分拣长度') }}</label>
            <span class="v">{{ (bParams as InserterParameters).length }}</span>
        </div>
        <template v-if="bParams && isEjector(building.itemId)">
            <div>
                <label>{{ t('送入轨道') }}</label>
                <span class="v">{{ (bParams as EjectorParameters).orbitId === 0 ? t('不选轨道') : (bParams as EjectorParameters).orbitId }}</span>
            </div>
            <div>
                <label>{{ t('十倍射速') }}</label>
                <span class="v">{{ truth((bParams as EjectorParameters).boost) }}</span>
            </div>
        </template>
        <div v-if="bParams && isEnergyExchanger(building.itemId)">
            <label>{{ t('模式') }}</label>
            <span class="v">{{ energyExchangerMode }}</span>
        </div>
        <div v-if="bParams && isRayReciver(building.itemId)">
            <label>{{ t('模式') }}</label>
            <span class="v">{{ (bParams as PowerGeneratorParameters).productId > 0 ? t('光子生成') : t('直接发电') }}</span>
        </div>
        <div v-if="bParams && isArtificialStar(building.itemId)">
            <label>{{ t('百倍发电') }}</label>
            <span class="v">{{ truth((bParams as ArtifacialStarParameters).boost) }}</span>
        </div>
    </div>
    <div v-if="beltParams">
        <BuildingIcon :icon-id="beltParams.iconId" />{{ beltParams.count }}
    </div>
    <div class="tank-io" v-if="bParams && isTank(building.itemId)">
        <SwitchDSP :opened="(bParams as TankParameters).output">{{ t('储液罐输出') }}</SwitchDSP>
        <SwitchDSP :opened="(bParams as TankParameters).input">{{ t('储液罐输入') }}</SwitchDSP>
    </div>
    <DispenserInfo v-if="bParams && isDispenser(building.itemId)" :building="building" />
</template>

<script lang="ts">
import { ResearchMode, AcceleratorMode, EnergyExchangerMode } from '@/blueprint/parser';

const labModeTexts = new Map([
    [ResearchMode.None, '选择模式'],
    [ResearchMode.Compose, '矩阵合成'],
    [ResearchMode.Research, '科研模式'],
]);

const accModeTexts = new Map([
    [AcceleratorMode.ExtraOutput, '额外产出'],
    [AcceleratorMode.Accelerate, '加速生产'],
]);

const energyExchangerModeTexts = new Map([
    [EnergyExchangerMode.Discharge, '放电'],
    [EnergyExchangerMode.StandBy, '待机'],
    [EnergyExchangerMode.Charge, '充电'],
]);
</script>

<script lang="ts" setup>
import { computed, defineAsyncComponent, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { truth } from '@/utils';
import {
    LabParamerters, AssembleParamerters, TankParameters, BlueprintBuilding,
    BeltParameters, InserterParameters, EjectorParameters,
    EnergyExchangerParameters, PowerGeneratorParameters, ArtifacialStarParameters, CollectorParameters,
} from '@/blueprint/parser';
import { itemIconId } from '@/data/icons';
import {
    isLab, allAssemblers, isBelt, isStation, itemsMap, isInserter, isStorage, isTank,
    isEjector, isEnergyExchanger, isArtificialStar, isRayReciver, isMonitor, isSplitter,
    isBattleBase, isDispenser, isOrbitalCollector, isMarker,
} from '@/data/items';
import { recipesMap } from '@/data';
import { commandQueueKey } from '@/define';

import BuildingRecipe from './BuildingRecipe.vue';
import BuildingIcon from './BuildingIcon.vue';
import StationInfo from './StationInfo.vue';
import MarkerInfo from './MarkerInfo.vue';
import MonitorInfo from './MonitorInfo.vue';
import BattleBaseInfo from './BattleBaseInfo.vue';
import StorageInfo from './StorageInfo.vue';
import DispenserInfo from './DispenserInfo.vue';
import SwitchDSP from './SwitchDSP.vue';
const SplitterInfo = defineAsyncComponent(() => import(/* webpackChunkName: "renderer" */'./SpitterInfo.vue'));

const { t } = useI18n();

const commandQueue = inject(commandQueueKey)!.value!;

const props = defineProps<{
    building: BlueprintBuilding,
}>();

const buildingItem = computed(() => {
    return itemsMap.get(props.building.itemId)!;
})
const filterVersion = ref(0);
const filterItem = computed(() => {
    filterVersion.value;
    if (props.building.filterId <= 0)
        return null;
    return itemsMap.get(props.building.filterId)!;
})
commandQueue.updater.updateSorterIcon.onMounted(b => {
    if (b === props.building)
        filterVersion.value++;
});

const LabModeText = computed(() => {
    const mode = (props.building.parameters as LabParamerters).researchMode;
    return t(labModeTexts.get(mode)!);
})
const productive = computed(() => {
    const recipeId = props.building.recipeId;
    if (recipeId === 0)
        return undefined;
    const recipe = recipesMap.get(recipeId)!;
    if (recipe.nonProductive)
        return false;
    let p = true;
    for (const i of recipe.to)
        p &&= i.item.productive === true;
    return p;
})
const accModeText = computed(() => {
    if (!allAssemblers.has(props.building.itemId))
        return undefined;

    const p = productive.value;
    if (p === undefined)
        return undefined;
    let mode = AcceleratorMode.Accelerate;
    const params = props.building.parameters as AssembleParamerters | null;
    if (p && params)
        mode = params.acceleratorMode;
    return t(accModeTexts.get(mode)!);
})

const beltVersion = ref(0);
const beltParams = computed(() => {
    beltVersion.value;
    if (isBelt(props.building.itemId) && props.building.parameters)
        return props.building.parameters as BeltParameters;
    return null;
});
commandQueue.updater.updateBeltIcon.onMounted(b => {
    if (b === props.building)
        beltVersion.value++;
});

const bParams = computed(() => props.building.parameters);
const fmt = (v: number) => String(Math.round(v * 100) / 100);
const position = computed(() => {
    const p = props.building.localOffset[0];
    return `${fmt(p.x)}, ${fmt(p.y)}`;
});
const energyExchangerMode = computed(() => {
    const mode = (props.building.parameters as EnergyExchangerParameters).mode;
    return t(energyExchangerModeTexts.get(mode)!);
});
</script>

<style lang="scss">
.detail-head {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 14px;
    .icon { width: 48px; flex: none; }
    .detail-name { margin: 0; font: 600 16px/1.3 var(--cjk); color: var(--text); }
    p {
        margin: 2px 0 0;
        font: 12px var(--num);
        color: var(--muted);
        span { margin-left: 8px; }
    }
}

.building-params {
    margin-bottom: 20px;
    h3 {
        margin-bottom: 0;
    }

    >div, .p {
        display: flex;
        flex-direction: row;
        margin-top: 4px;
    }
    .r {
        gap: 10px;
    }
    .p {
        gap: 5px;
    }
    label {
        display: inline-block;
        color: var(--muted);
    }
    .v {
        display: inline-block;
        text-align: right;
        flex: auto;
    }
}

.tank-io {
    display: flex;
    flex-direction: row;
    gap: 6px;

    .switch {
        flex: 1 50px;
    }
}
</style>

<i18n>
{
    "zh": {
        "模式": "模式",
        "送入轨道": "送入轨道",
        "位置": "位置"
    },
    "en": {
        "模式": "Mode",
        "送入轨道": "Orbit",
        "位置": "Position"
    },
    "fr": {
        "模式": "Mode",
        "送入轨道": "Orbit"
    }
}
</i18n>
