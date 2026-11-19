<template>
    <div class="field">
        <span class="label" aria-hidden="true">{{ t('缩略图图标') }}</span>
        <IconSlots :icons="header.icons" @set="setIcon" />
    </div>
    <div class="field">
        <label for="edit-layout">{{ t('图标布局') }}</label>
        <select id="edit-layout" v-model="layout">
            <option v-for="[id, s] of allIconLayouts" :key="id" :value="id">{{ id === 1 ? t('无') : s }}</option>
        </select>
    </div>
    <div class="field">
        <label for="edit-short">{{ t('缩略图文字') }}</label>
        <input type="text" id="edit-short" class="input"
               :value="header.shortDesc"
               @input="e => header.shortDesc = (e.target as HTMLInputElement).value">
    </div>
    <div class="field">
        <label for="edit-desc">{{ t('蓝图介绍') }}</label>
        <textarea id="edit-desc" rows="3"
                  :value="header.desc"
                  @input="e => header.desc = (e.target as HTMLTextAreaElement).value"></textarea>
    </div>

    <h3>{{ t('批量修改') }}</h3>
    <div class="op-row">
        <button type="button" class="btn" @click="replaceModal!.open()">
            <img src="@/assets/icons/find_replace.svg" alt="" aria-hidden="true">
            {{ t('批量替换') }}
        </button>
        <button type="button" class="btn ghost" :disabled="!commandQueue.canUndo()" @click="commandQueue.undo()"
                :title="t('撤销') + ' (Ctrl+Z)'">
            <img src="@/assets/icons/undo.svg" alt="" aria-hidden="true">
            {{ t('撤销') }}
        </button>
        <button type="button" class="btn ghost" :disabled="!commandQueue.canRedo()" @click="commandQueue.redo()"
                :title="t('重做') + ' (Ctrl+Y)'">
            <img src="@/assets/icons/redo.svg" alt="" aria-hidden="true">
            {{ t('重做') }}
        </button>
    </div>
    <ReplaceModal :blueprint="commandQueue.data" ref="replaceModal" />

    <h3><label for="edit-code">{{ t('蓝图代码') }}</label></h3>
    <textarea id="edit-code" class="code" readonly :value="code"
              @focus="onCodeFocus" @copy="onCopy"></textarea>
    <p class="hint">{{ t('代码提示') }}</p>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { commandQueueKey } from '@/define';
import ReplaceModal from '../ReplaceModal.vue';
import IconSlots from './IconSlots.vue';

const props = defineProps<{
    /** 显示用（过长时截断）的蓝图代码 */
    code: string,
    /** 取最新的完整蓝图代码 */
    getCode: () => string,
}>();

const { t } = useI18n();
const commandQueue = inject(commandQueueKey)!.value!;
// 头部是响应式对象，直接改，导出代码时会带上
const header = commandQueue.data.header;
const replaceModal = ref<null | InstanceType<typeof ReplaceModal>>(null);

const allIconLayouts = new Map<number, string>([
    [ 1, '无'],
    [10, '1-1'], [11, '1-2'],
    [20, '2-1'], [21, '2-2'], [22, '2-3'], [23, '2-4'], [24, '2-5'],
    [30, '3-1'], [31, '3-2'], [32, '3-3'], [33, '3-4'],
    [40, '4-1'], [41, '4-2'],
    [50, '5-1'], [51, '5-2'],
]);
const layout = computed<number>({
    get: () => header.layout,
    set: v => { header.layout = v; },
});

const setIcon = (i: number, id: number) => {
    while (header.icons.length <= i)
        header.icons.push(0);
    header.icons[i] = id;
};

const onCodeFocus = async (e: FocusEvent) => {
    const el = e.target as HTMLTextAreaElement;
    // 聚焦时重新编码，显示的是最新代码
    props.getCode();
    await nextTick();
    el.select();
};

// 显示的代码可能被截断，复制时总是给完整代码
const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', props.getCode());
};
</script>

<style lang="scss" scoped>
.field {
    margin-bottom: 14px;
    label, .label {
        display: block;
        margin-bottom: 6px;
        font-size: 12.5px;
        color: var(--muted);
    }
}
.input, textarea, select {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--deep);
    color: var(--text);
    font: inherit;
    &:focus { border-color: var(--line-2); }
}
.field textarea {
    resize: vertical;
    min-height: 64px;
}
h3 {
    margin: 22px 0 10px;
    font: 600 13px/1.4 var(--cjk);
    color: var(--muted);
    label { cursor: inherit; }
}
.op-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    img { width: 18px; height: 18px; }
}
.code {
    height: 88px;
    font: 11.5px/1.5 var(--code);
    color: var(--muted);
    resize: none;
    word-break: break-all;
}
.hint {
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--faint);
}
</style>

<i18n>
{
    "zh": {
        "缩略图图标": "缩略图图标",
        "批量修改": "批量修改",
        "批量替换": "批量替换",
        "撤销": "撤销",
        "重做": "重做",
        "代码提示": "这里的修改会写进「复制蓝图代码」和「保存为文件」得到的代码。"
    },
    "en": {
        "缩略图图标": "Thumbnail icons",
        "批量修改": "Batch edits",
        "批量替换": "Batch replace",
        "撤销": "Undo",
        "重做": "Redo",
        "代码提示": "Edits here go into the code from \"Copy blueprint code\" and \"Save as file\"."
    }
}
</i18n>
