<template>
    <div class="settings" ref="root" @keydown.esc="close(true)">
        <button ref="trigger" type="button" class="btn ghost icon-btn"
                :aria-label="t('设置')" :title="t('设置')"
                aria-haspopup="true" :aria-expanded="open" :aria-controls="popId"
                @click="open = !open">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
        </button>
        <div v-show="open" :id="popId" class="pop" role="group" :aria-label="t('设置')">
            <label>
                <span>{{ t('语言') }} <span class="en" v-if="locale !== 'en'">Language</span></span>
                <select v-model="settings.lang">
                    <option value="auto">{{ t('自动') }}</option>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                </select>
            </label>
            <label>
                <span>{{ t('默认显示') }}</span>
                <select v-model="settings.defaultMode">
                    <option value="auto">{{ t('自动') }}</option>
                    <option value="box">{{ t('精简') }}</option>
                    <option value="model">{{ t('真实模型') }}</option>
                </select>
            </label>
            <p class="pop-note">{{ t('自动说明') }}</p>
            <label>
                <span>{{ t('显示网格') }}</span>
                <input type="checkbox" v-model="settings.grid">
            </label>
            <label>
                <span>{{ t('传送带流向动画') }}</span>
                <input type="checkbox" v-model="settings.flow">
            </label>
        </div>
    </div>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { settingsKey } from '@/settings';

const { t, locale } = useI18n();
const settings = inject(settingsKey)!;

// 空状态和侧栏头部各有一个实例，id 需要不同
const popId = `settings-pop-${Math.random().toString(36).slice(2, 8)}`;
const open = ref(false);
const emit = defineEmits<{ (e: 'openChange', open: boolean): void }>();
watch(open, o => emit('openChange', o));
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

const close = (refocus = false) => {
    if (!open.value)
        return;
    open.value = false;
    if (refocus)
        trigger.value?.focus();
};

// 点弹层外面关闭
const onPointerDown = (e: PointerEvent) => {
    if (open.value && root.value && !root.value.contains(e.target as Node))
        close();
};
onMounted(() => document.addEventListener('pointerdown', onPointerDown));
onUnmounted(() => document.removeEventListener('pointerdown', onPointerDown));
</script>

<style lang="scss" scoped>
.settings {
    position: relative;
}
.icon-btn {
    color: var(--muted);
    &:hover, &[aria-expanded="true"] { color: var(--text); }
    svg { width: 18px; height: 18px; }
}
.pop {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    z-index: 20;
    width: 248px;
    box-sizing: border-box;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel-2);
    box-shadow: 0 16px 40px rgba(0, 0, 0, .4);
    text-align: start;

    label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 2px;
        font-size: 13px;
        cursor: pointer;
    }
    .en { color: var(--faint); font-size: 12px; }
    select {
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid var(--line);
        background: var(--deep);
        color: var(--text);
        font: inherit;
        font-size: 13px;
    }
    input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--holo);
    }
}
.pop-note {
    margin: 0 2px 6px;
    font-size: 11.5px;
    color: var(--muted);
}
</style>

<i18n>
{
    "zh": {
        "设置": "设置",
        "语言": "语言",
        "自动": "自动",
        "默认显示": "默认显示",
        "精简": "精简",
        "真实模型": "真实模型",
        "自动说明": "自动：网络慢或开启省流量时用精简，否则用真实模型。",
        "显示网格": "显示网格",
        "传送带流向动画": "传送带流向动画"
    },
    "en": {
        "设置": "Settings",
        "语言": "Language",
        "自动": "Auto",
        "默认显示": "Default display",
        "精简": "Simple",
        "真实模型": "Real model",
        "自动说明": "Auto: Simple on slow networks or with data saver on, otherwise Real model.",
        "显示网格": "Show grid",
        "传送带流向动画": "Belt flow animation"
    }
}
</i18n>
