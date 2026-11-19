<template>
    <section v-if="info" class="prod" :aria-label="t('生产详情')">
        <h4>{{ t('满速产出') }} <span class="hint">{{ t('未计增产剂') }}</span></h4>
        <ul class="rates">
            <li v-for="o of info.outputs" :key="'o' + o.itemId">
                <BuildingIcon :icon-id="itemIconId(o.itemId)" alt="" />
                <span class="name">{{ itemName(o.itemId) }}</span>
                <span class="num">{{ fmt(o.perMin) }}<small>{{ t('每分钟') }}</small></span>
            </li>
        </ul>
        <h4>{{ t('满速消耗') }}</h4>
        <ul class="rates">
            <li v-for="i of info.inputs" :key="'i' + i.itemId">
                <BuildingIcon :icon-id="itemIconId(i.itemId)" alt="" />
                <span class="name">{{ itemName(i.itemId) }}</span>
                <span class="num">{{ fmt(i.perMin) }}<small>{{ t('每分钟') }}</small></span>
            </li>
        </ul>

        <h4>{{ t('连接') }}</h4>
        <p class="conn">{{ t('连接汇总', { inCount: connections.inCount, outCount: connections.outCount }) }}</p>
        <div v-if="connections.items.length" class="neighbours">
            <BuildingIcon v-for="c of connections.items" :key="c.itemId" :icon-id="itemIconId(c.itemId)"
                          :alt="itemName(c.itemId)" :count="c.count" />
        </div>

        <div class="actions">
            <button type="button" class="btn" ref="changeBtn" @click="openRecipes">{{ t('更换配方') }}</button>
            <button type="button" class="btn" :disabled="!sameTypeCount" @click="selectAll">{{ t('选中全部', { n: sameTypeCount }) }}</button>
        </div>
        <!-- 复用现有的配方选择弹窗；它自带图标触发器，这里由上面的按钮代为点击 -->
        <span ref="trigger" class="trigger">
            <RecipeSelect :recipeId="building.recipeId" @update:recipeId="onRecipe" />
        </span>
    </section>
</template>

<script lang="ts">
import type { BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import type { Command, Updater } from '@/command';

/** 把一个建筑的配方换成另一个，可撤销 */
export class SetRecipeCommand implements Command {
    private readonly before: number;
    constructor(private readonly b: BlueprintBuilding, private readonly after: number) {
        this.before = b.recipeId;
    }
    private set(id: number, updater: Updater) {
        this.b.recipeId = id;
        updater.updateBuildingIcon.dispatch(this.b);
    }
    do(_data: BlueprintData, updater: Updater) { this.set(this.after, updater); }
    undo(_data: BlueprintData, updater: Updater) { this.set(this.before, updater); }
    merge() { return false; }
}
</script>

<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gameEnv } from '@/analysis/gameEnv';
import { recipeRates } from '@/analysis/materialFlow';
import { connectionSummary } from '@/analysis/connections';
import { buildingInfoKey, commandQueueKey, rendererKey } from '@/define';
import { itemIconId } from '@/data/icons';
import { itemName } from '@/i18n';
import BuildingIcon from '../BuildingIcon.vue';
import RecipeSelect from '../RecipeSelect.vue';

const props = defineProps<{ building: BlueprintBuilding }>();
const { t } = useI18n();

const queue = inject(commandQueueKey)!.value!;
const buildingInfo = inject(buildingInfoKey)!.value!;
const renderer = inject(rendererKey, ref(null));

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/** 只有有配方且按配方工作的建筑（制造台、熔炉、化工厂、研究站……）才有满速产出；采矿机不显示 */
const info = computed(() => {
    void queue.execVersion.value;
    const b = props.building;
    const worker = gameEnv.worker(b.modelIndex);
    const recipe = b.recipeId > 0 ? gameEnv.recipe(b.recipeId) : undefined;
    if (worker?.kind !== 'craft' || !recipe || recipe.time <= 0)
        return null;
    return recipeRates(recipe, worker.speed);
});

const connections = computed(() => {
    void queue.execVersion.value;
    return connectionSummary(props.building, buildingInfo.adjacency);
});

const sameTypeCount = computed(() => {
    void queue.execVersion.value;
    return queue.data.buildings.filter(b => b.itemId === props.building.itemId).length;
});
const selectAll = () => { renderer.value?.selectAll(props.building.itemId); };

const trigger = ref<HTMLElement | null>(null);
const changeBtn = ref<HTMLElement | null>(null);
const openRecipes = () => {
    trigger.value?.querySelector<HTMLElement>('.icon-select')?.click();
};
const onRecipe = async (id: number | null) => {
    if (id !== null && id !== props.building.recipeId)
        queue.push(new SetRecipeCommand(props.building, id));
    await nextTick();
    changeBtn.value?.focus();
};
</script>

<style lang="scss" scoped>
.prod { margin-top: 16px; padding-top: 4px; border-top: 1px solid var(--line); }
h4 { margin: 14px 0 6px; font-size: 13px; color: var(--muted); font-weight: 600; }
.hint { font-weight: 400; color: var(--faint); font-size: 12px; }
.rates { margin: 0; padding: 0; list-style: none; }
.rates li { display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; align-items: center; padding: 3px 0; }
.rates :deep(.icon) { width: 26px; height: 26px; }
.num { font: 600 15px var(--num); small { margin-left: 4px; font: 11px var(--cjk); color: var(--muted); font-weight: 400; } }
.conn { margin: 0 0 6px; font-size: 13px; }
.neighbours { display: flex; flex-wrap: wrap; gap: 6px; :deep(.icon) { width: 32px; } }
.trigger :deep(.icon-select) { display: none; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.btn {
    padding: 7px 12px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--panel-2);
    color: var(--text); font: inherit; font-size: 13px; cursor: pointer;
    &:hover:not(:disabled) { border-color: var(--holo); }
    &:disabled { opacity: .5; cursor: default; }
}
</style>

<i18n>
{
    "zh": {
        "生产详情": "生产详情",
        "满速产出": "满速产出",
        "满速消耗": "满速消耗",
        "未计增产剂": "未计增产剂",
        "每分钟": "/分",
        "连接": "连接",
        "连接汇总": "输入 {inCount} 个连接，输出 {outCount} 个连接",
        "更换配方": "更换配方",
        "选中全部": "选中全部 {n} 个同类建筑"
    },
    "en": {
        "生产详情": "Production details",
        "满速产出": "Output at full speed",
        "满速消耗": "Consumption at full speed",
        "未计增产剂": "proliferator not included",
        "每分钟": "/min",
        "连接": "Connections",
        "连接汇总": "{inCount} input connection(s), {outCount} output connection(s)",
        "更换配方": "Change recipe",
        "选中全部": "Select all {n} of this type"
    }
}
</i18n>
