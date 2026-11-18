<template>
    <div class="intake" :class="{ dragging }">
        <section class="intake-card" aria-labelledby="intake-title" :aria-busy="loading.active">
            <h1 id="intake-title">{{ t('标题') }}</h1>
            <p>{{ t('说明') }}</p>
            <div class="drop">
                <textarea id="intake-code" :aria-label="t('蓝图代码')" placeholder="BLUEPRINT:1,10,2303,…"
                    :value="input" :disabled="loading.active" spellcheck="false"
                    @input="e => emit('update:input', (e.target as HTMLTextAreaElement).value)"
                    @paste="onPaste"
                    @change="e => submit((e.target as HTMLTextAreaElement).value)"></textarea>
            </div>
            <div v-if="loading.visible" class="progress" role="progressbar" :aria-label="t('解析中')"
                :aria-valuemin="0" :aria-valuemax="loading.total" :aria-valuenow="loading.done">
                <i :style="{ width: percent + '%' }"></i>
            </div>
            <div v-if="loading.visible" class="progress-text" aria-live="polite">
                {{ t('已读取建筑', { done: loading.done, total: loading.total }) }}
            </div>
            <OpenError v-if="error" :error="error" />
            <div class="row">
                <button class="btn primary" type="button" :disabled="loading.active" @click="pasteClipboard">
                    {{ t('从剪贴板粘贴') }}
                </button>
                <label class="btn file" :class="{ disabled: loading.active }" tabindex="0"
                    @keydown.enter.prevent="fileInput?.click()" @keydown.space.prevent="fileInput?.click()">
                    {{ t('选择文件') }}
                    <input ref="fileInput" type="file" accept=".txt,text/plain" :disabled="loading.active"
                        tabindex="-1" @change="onFile" />
                </label>
                <span class="hint">{{ t('支持到游戏', { version: supported }) }}</span>
            </div>
            <div v-if="recent.length" class="recent">
                <div class="recent-head">
                    <span>{{ t('最近打开') }}</span>
                    <button class="link" type="button" @click="emit('clearRecent')">{{ t('清空记录') }}</button>
                </div>
                <ul>
                    <li v-for="r in recent" :key="r.id">
                        <button type="button" :disabled="loading.active" @click="emit('open', r.code)">
                            <img v-if="icons[r.id]" :src="icons[r.id]" alt="">
                            <span v-else></span>
                            <span class="name">{{ r.name || t('未命名') }}</span>
                            <time :datetime="new Date(r.openedAt).toISOString()">{{ when(r.openedAt) }}</time>
                        </button>
                    </li>
                </ul>
                <p class="recent-note">{{ t('只保存在本机') }}</p>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { iconUrl } from '@/data/icons';
import type { ParseErrorInfo } from '@/open/errorMap';
import type { RecentEntry } from '@/open/recentStore';
import { recentIconUrls } from '@/open/recentIcons';
import OpenError from './OpenError.vue';

const props = defineProps<{
    input: string;
    error: ParseErrorInfo | null;
    loading: { active: boolean; visible: boolean; done: number; total: number };
    recent: RecentEntry[];
    supported: string;
    dragging?: boolean;
}>();
const emit = defineEmits<{
    (e: 'update:input', v: string): void;
    (e: 'open', code: string): void;
    (e: 'clearRecent'): void;
}>();
const { t, locale } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const percent = computed(() => props.loading.total ? Math.round(props.loading.done / props.loading.total * 100) : 0);

const submit = (s: string) => { if (s.trim()) emit('open', s); };

const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text)
        return;
    e.preventDefault();
    emit('update:input', text);
    submit(text);
};

const pasteClipboard = async () => {
    try {
        submit(await navigator.clipboard.readText());
    } catch {
        alert(t('剪贴板不可用'));
    }
};

const onFile = async (e: Event) => {
    const el = e.target as HTMLInputElement;
    const f = el.files?.[0];
    if (f)
        submit(await f.text());
    el.value = '';
};

// iconUrl 是异步的，解析完再交给 <img>；列表变化时丢弃过期的结果
const icons = ref<Record<string, string>>({});
watch(() => props.recent, async list => {
    const urls = await recentIconUrls(list, iconUrl);
    if (list === props.recent)
        icons.value = urls;
}, { immediate: true });

const when = (ts: number) => {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return d.toLocaleString(locale.value, sameDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
</script>

<style lang="scss" scoped>
$line: #2a3f5c;
$muted: #9bb0c9;
$faint: #6f84a0;
$holo: #7fd8ff;

.intake {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(8, 16, 27, .55);
    color: #e6eefb;
    overflow-y: auto;
    &.dragging .drop { border-color: $holo; background: #0d2236; }
}
.intake-card {
    width: min(560px, 100%);
    box-sizing: border-box;
    padding: 28px;
    border: 1px solid $line;
    border-radius: 14px;
    background: rgba(18, 30, 48, .94);
    box-shadow: 0 24px 60px rgba(0, 0, 0, .45);
    @media (max-width: 760px) { padding: 20px; }
}
h1 { margin: 0 0 6px; font-size: 24px; line-height: 1.25; font-weight: 600; @media (max-width: 760px) { font-size: 20px; } }
p { margin: 0 0 18px; color: $muted; }
.drop {
    border: 1.5px dashed #3b5578;
    border-radius: 10px;
    background: #08101b;
    textarea {
        display: block; width: 100%; height: 112px; box-sizing: border-box; padding: 12px 14px;
        border: 0; border-radius: 10px; resize: none; background: transparent;
        font: 12.5px/1.55 ui-monospace, Menlo, Consolas, monospace; color: $muted; word-break: break-all;
        &::placeholder { color: $faint; }
        &:focus-visible { outline: 2px solid $holo; outline-offset: 2px; }
    }
}
.progress { height: 4px; margin-top: 16px; border-radius: 2px; background: #1b2c44; overflow: hidden; i { display: block; height: 100%; background: $holo; } }
.progress-text { margin-top: 6px; font-size: 12px; color: $muted; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; align-items: center; }
.hint { margin-left: auto; font-size: 12px; color: $faint; }
.btn {
    box-sizing: border-box; padding: 8px 14px; border-radius: 8px; border: 1px solid $line;
    background: #121e30; color: inherit; font-size: 14px; cursor: pointer; position: relative;
    &.primary { background: $holo; color: #06121f; border-color: $holo; font-weight: 600; }
    &[disabled], &.disabled { opacity: .5; cursor: default; }
    &:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    input[type="file"] { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer; }
}
.recent { margin-top: 22px; padding-top: 16px; border-top: 1px solid $line; }
.recent-head { display: flex; justify-content: space-between; font-size: 12.5px; color: $muted; margin-bottom: 6px; }
.link { background: none; border: 0; color: $holo; cursor: pointer; font-size: 12.5px; padding: 0; &:focus-visible { outline: 2px solid $holo; } }
ul { list-style: none; margin: 0; padding: 0; }
li button {
    width: 100%; display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center;
    padding: 7px 8px; border: 0; border-radius: 8px; background: none; cursor: pointer; text-align: start; color: inherit;
    &:hover { background: #172740; }
    &:focus-visible { outline: 2px solid $holo; }
    img { width: 24px; height: 24px; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    time { font-size: 12px; color: $faint; font-variant-numeric: tabular-nums; }
}
.recent-note { margin: 8px 0 0; font-size: 11.5px; color: $faint; }
</style>

<i18n>
{
    zh: {
        "标题": "预览戴森球计划蓝图",
        "说明": "粘贴从游戏或 dsp2b 复制的蓝图代码，或者把蓝图 .txt 文件拖到这里。",
        "蓝图代码": "蓝图代码",
        "解析中": "解析中",
        "已读取建筑": "已读取建筑 {done} / {total}",
        "从剪贴板粘贴": "从剪贴板粘贴",
        "选择文件": "选择文件",
        "支持到游戏": "支持到游戏 {version}",
        "最近打开": "最近打开",
        "清空记录": "清空记录",
        "未命名": "未命名",
        "只保存在本机": "只保存在这台设备的浏览器里。",
        "剪贴板不可用": "无法读取剪贴板，请手动粘贴到文本框。"
    },
    en: {
        "标题": "Preview Dyson Sphere Program blueprints",
        "说明": "Paste a blueprint code copied from the game or dsp2b, or drop a blueprint .txt file here.",
        "蓝图代码": "Blueprint code",
        "解析中": "Parsing",
        "已读取建筑": "Read {done} / {total} buildings",
        "从剪贴板粘贴": "Paste from clipboard",
        "选择文件": "Choose file",
        "支持到游戏": "Supports game up to {version}",
        "最近打开": "Recently opened",
        "清空记录": "Clear all",
        "未命名": "Untitled",
        "只保存在本机": "Stored only in this browser on this device.",
        "剪贴板不可用": "Cannot read the clipboard. Please paste into the text box."
    },
}
</i18n>
