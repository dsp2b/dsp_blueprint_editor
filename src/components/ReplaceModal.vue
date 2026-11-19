<template>
    <Modal v-model:open="open">
        <div class="replace-modal">
            <h2>{{t('批量替换')}}</h2>
            <div class="replace-row"><span>{{t('搜索：')}}</span> <RecipeSelect v-model:recipeId="r.searchRecipe"/></div>
            <div class="replace-row"><span>{{t('替换：')}}</span> <RecipeSelect v-model:recipeId="r.replaceRecipe"/></div>
            <fieldset class="replace-row">
                <legend>{{t('范围：')}}</legend>
                <span class="replace-scope">
                    <input type="checkbox" id="replace-recipe" v-model="r.scope.recipe"><label for="replace-recipe">{{t('配方')}}</label>
                </span>
                <span class="replace-scope">
                    <input type="checkbox" id="replace-filter" v-model="r.scope.filter"><label for="replace-filter">{{t('分拣器筛选')}}</label>
                </span>
                <span class="replace-scope">
                    <input type="checkbox" id="replace-station" v-model="r.scope.station"><label for="replace-station">{{t('物流塔栏位')}}</label>
                </span>
                <span class="replace-scope">
                    <input type="checkbox" id="replace-band-icon" v-model="r.scope.beltIcon"><label for="replace-band-icon">{{t('传送带图标')}}</label>
                </span>
                <span class="replace-scope">
                    <input type="checkbox" id="replace-bp-icon" v-model="r.scope.blueprintIcon"><label for="replace-bp-icon">{{t('蓝图图标')}}</label>
                </span>
            </fieldset>
            <div class="replace-actions">
                <button type="button" class="btn primary" @click="executeReplace" :disabled="!canReplace">{{t('全部替换')}}</button>
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { computed, inject, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

import { ReplaceCommand, ReplaceParams } from "@/blueprint/replace";
import { BlueprintData } from "@/blueprint/parser";
import Modal from "./ModalDSP.vue";
import RecipeSelect from "./RecipeSelect.vue";
import { commandQueueKey } from "@/define";

const { t } = useI18n();
const commandQueue = inject(commandQueueKey)!.value!;

const open = ref(false);

defineExpose({
    open: () => open.value = true,
})

const r = reactive({
    searchRecipe: null as null | number,
    replaceRecipe: null as null | number,
    scope: {
        recipe: true,
        filter: true,
        station: true,
        beltIcon: true,
        blueprintIcon: true,
    },
});

const props = defineProps<{blueprint: BlueprintData}>()

const canReplace = computed(() => {
    return r.searchRecipe !== null && r.replaceRecipe !== null && Object.values(r.scope).some(s => s);
})

const executeReplace = () => {
    if (!canReplace.value)
        return;
    commandQueue.push(new ReplaceCommand(props.blueprint, r as ReplaceParams));
    open.value = false;
}
</script>

<style lang="scss">
.replace-modal {
    h2 { margin: 0 0 14px; font-size: 17px; font-weight: 600; }
    .replace-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 12px;
        > span:first-child { min-width: 4em; color: var(--muted); font-size: 13px; }
        .icon-select {
            box-sizing: border-box;
            width: 44px;
            height: 44px;
            display: grid;
            place-items: center;
            border-radius: 8px;
            border: 1px dashed var(--line-2);
            background: var(--deep);
            .icon { width: 32px; }
            .icon-placeholder { display: none; }
        }
    }
    fieldset {
        border: 0;
        padding: 0;
        legend { float: left; min-width: 4em; margin-right: 8px; color: var(--muted); font-size: 13px; }
    }
    input[type="checkbox"] { accent-color: var(--holo); }
    .replace-actions { display: flex; justify-content: flex-end; }
}

.replace-scope {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;

    @media screen and (max-width: 360px) {
        display: flex;
    }
}
</style>

<i18n>
{
    "zh": {
        "批量替换": "批量替换",
        "搜索：": "搜索：",
        "替换：": "替换：",
        "范围：": "范围：",
        "配方": "配方",
        "分拣器筛选": "分拣器筛选",
        "物流塔栏位": "物流塔栏位",
        "传送带图标": "传送带图标",
        "蓝图图标": "蓝图图标",
        "全部替换": "全部替换",
    },
    "en": {
        "批量替换": "Batch Replace",
        "搜索：": "Search:",
        "替换：": "Replace:",
        "范围：": "Scope:",
        "配方": "Recipe",
        "分拣器筛选": "Sorter",
        "物流塔栏位": "Station",
        "传送带图标": "Belt Icon",
        "蓝图图标": "Blueprint Icon",
        "全部替换": "Replace All",
    },
    "fr": {
        "批量替换": "Remplacer en vrac",
        "搜索：": "Recherche:",
        "替换：": "Remplacer:",
        "范围：": "Portée:",
        "配方": "Recette",
        "分拣器筛选": "Trieuse",
        "物流塔栏位": "Station",
        "传送带图标": "Icône de ceinture",
        "蓝图图标": "Icône de plan",
        "全部替换": "Tout remplacer",
    }
}
</i18n>
