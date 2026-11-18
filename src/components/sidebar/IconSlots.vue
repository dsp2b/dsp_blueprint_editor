<template>
    <div class="slots" role="group" :aria-label="t('缩略图图标')">
        <div v-for="(id, i) of slots" :key="i" ref="slotEls" class="slot" :class="{ set: id > 0 }"
             :title="slotLabel(i, id)" @keydown.enter.prevent="pick" @keydown.space.prevent="pick">
            <ItemSelect :item-id="id > 0 ? id : null" @update:item-id="v => set(i, v)" />
            <button v-if="id > 0" type="button" class="clear" :aria-label="t('移除图标 {n}', { n: i + 1 })"
                    @click="set(i, 0)">×</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watchPostEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { itemsMap, recipesMap } from '@/data';
import { itemName, recipeName } from '@/i18n';
import ItemSelect from '../ItemSelect.vue';

/** 蓝图头部固定 5 个图标位 */
const SLOT_COUNT = 5;

const props = defineProps<{ icons: readonly number[] }>();
const emit = defineEmits<{ (e: 'set', index: number, iconId: number): void }>();
const { t } = useI18n();

const slots = computed(() => Array.from({ length: SLOT_COUNT }, (_, i) => props.icons[i] ?? 0));

const iconName = (id: number) => {
    if (itemsMap.has(id))
        return itemName(id);
    if (id >= 20000 && id < 40000 && recipesMap.has(id - 20000))
        return recipeName(id - 20000);
    return `#${id}`;
};
const slotLabel = (i: number, id: number) =>
    id > 0 ? t('图标 {n}：{name}', { n: i + 1, name: iconName(id) }) : t('添加图标 {n}', { n: i + 1 });

// ItemSelect 有两个根节点，属性传不进去，直接给它的触发元素加可读名称
const slotEls = ref<HTMLElement[]>([]);
watchPostEffect(() => {
    slots.value.forEach((id, i) => {
        slotEls.value[i]?.querySelector('.icon-select')?.setAttribute('aria-label', slotLabel(i, id));
    });
});

/** 选择器被关掉时会回报 null，这时保留原图标；移除图标用 × 按钮 */
const set = (i: number, v: number | null) => {
    if (v !== null)
        emit('set', i, v);
};

// ItemSelect 只响应点击，这里让 Enter/空格也能打开选择器
const pick = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('icon-select'))
        target.click();
};
</script>

<style lang="scss" scoped>
.slots {
    display: flex;
    gap: 6px;
}
.slot {
    position: relative;
    width: 44px;
    height: 44px;

    :deep(.icon-select) {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        border-radius: 8px;
        border: 1px dashed var(--line-2);
        background: var(--deep);
        .icon { width: 30px; }
        .icon-placeholder { display: none; }
        &:hover { border-color: var(--holo); }
    }
    &:not(.set) :deep(.icon-select)::before {
        content: "+";
        color: var(--faint);
        font-size: 16px;
    }
    &.set :deep(.icon-select) { border-style: solid; }
}
.clear {
    position: absolute;
    right: -5px;
    top: -5px;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--panel-3);
    color: var(--muted);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    &:focus-visible { opacity: 1; }
}
.slot:hover .clear, .slot:focus-within .clear { opacity: 1; }
@media (hover: none) { .clear { opacity: 1; } }
</style>

<i18n>
{
    "zh": {
        "缩略图图标": "缩略图图标",
        "图标 {n}：{name}": "图标 {n}：{name}",
        "添加图标 {n}": "添加图标 {n}",
        "移除图标 {n}": "移除图标 {n}"
    },
    "en": {
        "缩略图图标": "Thumbnail icons",
        "图标 {n}：{name}": "Icon {n}: {name}",
        "添加图标 {n}": "Add icon {n}",
        "移除图标 {n}": "Remove icon {n}"
    }
}
</i18n>
