<template>
    <header class="bp-head">
        <div class="thumb" role="img" :aria-label="t('蓝图缩略图') + (header.shortDesc ? '：' + header.shortDesc : '')">
            <BlueprintIcon class="thumb-icons" :layout-id="header.layout" :icons="header.icons" />
            <small v-if="header.shortDesc" aria-hidden="true">{{ header.shortDesc }}</small>
        </div>
        <div class="bp-title">
            <h2>{{ header.shortDesc || t('未命名蓝图') }}</h2>
            <span class="count">{{ t('{n} 个建筑', { n: buildingCount }) }}</span>
            <dl class="meta">
                <dt>{{ t('游戏版本') }}</dt><dd>{{ header.gameVersion }}</dd>
                <dt>{{ t('创建于') }}</dt><dd><time :datetime="header.time.toISOString()">{{ createdAt }}</time></dd>
            </dl>
        </div>
        <SettingsPopover @open-change="o => o && emit('settingsOpen')" />
    </header>
    <div class="bp-actions">
        <button type="button" class="btn primary" :disabled="disabled" @click="onCopy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
            <span aria-live="polite">{{ copied ? t('已复制') : t('复制蓝图代码') }}</span>
        </button>
        <button type="button" class="btn" :disabled="disabled" @click="emit('save')">{{ t('保存为文件') }}</button>
        <button type="button" class="btn" :disabled="disabled" :title="t('换一个蓝图')" @click="emit('switch')">{{ t('换蓝图') }}</button>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BlueprintData } from '@/blueprint/parser';
import BlueprintIcon from '../BlueprintIcon.vue';
import SettingsPopover from './SettingsPopover.vue';

/** "已复制"提示保留的时长 */
const COPIED_MS = 1600;

const props = defineProps<{
    header: BlueprintData['header'],
    buildingCount: number,
    disabled?: boolean,
    /** 复制蓝图代码，成功返回 true */
    copy: () => Promise<boolean>,
}>();
const emit = defineEmits<{
    (e: 'save'): void,
    (e: 'switch'): void,
    (e: 'settingsOpen'): void,
}>();

const { t } = useI18n();

const pad = (n: number) => String(n).padStart(2, '0');
const createdAt = computed(() => {
    // 游戏里的时间没有时区，按 UTC 原样显示
    const d = props.header.time;
    if (isNaN(d.getTime()))
        return '';
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
});

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
const onCopy = async () => {
    if (!(await props.copy()))
        return;
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => copied.value = false, COPIED_MS);
};
onUnmounted(() => clearTimeout(timer));
</script>

<style lang="scss" scoped>
.bp-head {
    display: grid;
    grid-template-columns: 76px 1fr auto;
    gap: 14px;
    padding: 18px 18px 14px;
    align-items: start;
}
.thumb {
    position: relative;
    width: 76px;
    height: 76px;
    box-sizing: border-box;
    border-radius: 12px;
    background: radial-gradient(circle at 50% 35%, #2B4A6E, #14243A 70%);
    border: 1px solid #355378;
    padding: 4px 6px 16px;
    overflow: hidden;

    .thumb-icons {
        display: block;
        width: 100%;
        height: 100%;
        background: none;
    }
    small {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 3px;
        padding: 0 4px;
        text-align: center;
        font-size: 10px;
        line-height: 1.3;
        color: #BFD6EE;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}
.bp-title {
    min-width: 0;
    h2 {
        margin: 2px 0 4px;
        font: 600 17px/1.3 var(--cjk);
        overflow-wrap: anywhere;
    }
    .count { display: none; }
}
.meta {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    dd {
        margin: 0;
        font-family: var(--num);
        color: var(--text);
        overflow-wrap: anywhere;
    }
}
.bp-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 18px 16px;
    .primary { flex: 1 0 auto; }
}

@media (max-width: 760px) {
    .bp-head {
        grid-template-columns: 56px 1fr auto;
        padding: 4px 16px 10px;
        gap: 12px;
    }
    .thumb {
        width: 56px;
        height: 56px;
        padding: 3px 4px 12px;
        border-radius: 10px;
        small { font-size: 9px; bottom: 1px; }
    }
    .meta { display: none; }
    .bp-title {
        h2 { font-size: 16px; }
        .count { display: block; font-size: 12px; color: var(--muted); }
    }
    .bp-actions { padding: 0 16px 12px; }
}
</style>

<i18n>
{
    "zh": {
        "蓝图缩略图": "蓝图缩略图",
        "未命名蓝图": "未命名蓝图",
        "{n} 个建筑": "{n} 个建筑",
        "游戏版本": "游戏版本",
        "创建于": "创建于",
        "复制蓝图代码": "复制蓝图代码",
        "已复制": "已复制",
        "保存为文件": "保存为文件",
        "换蓝图": "换蓝图",
        "换一个蓝图": "换一个蓝图"
    },
    "en": {
        "蓝图缩略图": "Blueprint thumbnail",
        "未命名蓝图": "Untitled blueprint",
        "{n} 个建筑": "{n} buildings",
        "游戏版本": "Game version",
        "创建于": "Created",
        "复制蓝图代码": "Copy code",
        "已复制": "Copied",
        "保存为文件": "Save as file",
        "换蓝图": "Switch",
        "换一个蓝图": "Switch blueprint"
    }
}
</i18n>
