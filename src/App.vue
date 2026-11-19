<template>
    <div class="app" :class="{ loaded: !!data }" @dragover="onDragOver" @dragleave="dragging = false" @drop="onDrop">
        <main ref="view" class="view" :aria-label="t('三维预览')" aria-describedby="view-desc">
            <p id="view-desc" class="sr-only">{{ t('三维预览说明') }}</p>
            <BlueprintEditor ref="renderer"
                v-model:selectedBuildingIndex="selectedBuildingIndex" />
            <OpenCard v-if="!data"
                v-model:input="session.input.value"
                :error="session.error.value ?? sourceError" :loading="cardLoading" :fetching="fetching"
                :recent="session.recent.value" :supported="supportedGameVersion" :dragging="dragging"
                @open="openCode" @clear-recent="session.clearRecent()" />
            <div v-if="!data" class="float-settings">
                <SettingsPopover />
            </div>
        </main>
        <SidebarPanel v-if="data" :key="openCount"
            :data="data" :selected-building="selectedBuilding"
            :code="bpStrInput" :get-code="bpStrLatest" :copy="copy" :disabled="working" :dsp2b-id="dsp2bId"
            @save="saveFile" @switch="switchBp">
            <!-- 已打开蓝图时拖入的新文件解析失败 -->
            <template v-if="session.error.value" #notice>
                <OpenError :error="session.error.value" />
            </template>
        </SidebarPanel>
    </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, provide, reactive, ref, shallowReactive, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { fromStr, toStr } from '@/blueprint/parser';
import { supportedGameVersion } from '@/data/types';
import { useBlueprintSession } from '@/open/session';
import { createWorkerParser, WorkerLike } from '@/open/workerParser';
import { fetchDsp2bBlueprint, isPlausibleId } from '@/open/dsp2bSource';
import type { ParseErrorInfo } from '@/open/errorMap';
import { createRecentStore } from '@/open/recentStore';
import { sessionKey } from '@/open/keys';
import { pastedText } from '@/open/paste';
import { browserStorage, createSettings, settingsKey } from '@/settings';
import OpenCard from './components/open/OpenCard.vue';
import OpenError from './components/open/OpenError.vue';
import { rendererKey, buildingInfoKey, commandQueueKey } from '@/define';
import { BuildingInfo } from './blueprint/buildingInfo';
import { CommandQueue } from './command';
import { useLang } from './i18n';
import SidebarPanel from './components/sidebar/SidebarPanel.vue';
import SettingsPopover from './components/sidebar/SettingsPopover.vue';
import './styles/theme.scss';
const BlueprintEditor = defineAsyncComponent(() => import(/* webpackChunkName: "renderer" */'./components/BlueprintEditor.vue'));

const { t } = useI18n();

const settings = createSettings(browserStorage());
provide(settingsKey, settings);
const lang = useLang();
watchEffect(() => { lang.value = settings.lang; });

const renderer = ref<null | InstanceType<typeof BlueprintEditor>>(null);
provide(rendererKey, renderer);

const parseInWorker = createWorkerParser({
    create: () => typeof Worker === 'undefined' ? null
        : new Worker(new URL('./open/parseWorker.ts', import.meta.url)) as unknown as WorkerLike,
    fallback: async (code, options) => {
        // 先让出一帧，使"解析中"状态有机会渲染
        await new Promise(resolve => setTimeout(resolve, 0));
        return fromStr(code, options);
    },
});
const bpStr = ref('');
const session = useBlueprintSession({
    parse: async (code, options) => {
        // 解析放在 Worker 里，主线程才能在解析期间重绘进度；Worker 不可用时退回主线程
        const parsed = shallowReactive(await parseInWorker(code, options));
        parsed.header = reactive(parsed.header);
        return parsed;
    },
    store: createRecentStore(),
    supported: supportedGameVersion,
    confirmReplace: () => window.confirm(t('确认替换')),
});
provide(sessionKey, session);
const data = session.data;
const dragging = ref(false);
const busy = ref(false);
const working = computed(() => busy.value || session.loading.value.active);

// 通过 ?id= 从 dsp2b 打开：取回期间沿用卡片的加载态（禁用输入）；失败在卡片上提示，仍可粘贴
const dsp2bId = ref<string | null>(null);
const fetching = ref(false);
const sourceError = ref<ParseErrorInfo | null>(null);
const cardLoading = computed(() => fetching.value && !session.loading.value.active
    ? { active: true, visible: false, done: 0, total: 0 }
    : session.loading.value);
/** 不再是 dsp2b 的蓝图（换蓝图或之后打开了别的）：去掉回链，并从地址栏移除 id，避免刷新又打开旧蓝图 */
const forgetDsp2b = () => {
    dsp2bId.value = null;
    const url = new URL(window.location.href);
    if (url.searchParams.has('id')) {
        url.searchParams.delete('id');
        history.replaceState(history.state, '', url.toString());
    }
};
onMounted(async () => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!isPlausibleId(id))
        return;
    fetching.value = true;
    const r = await fetchDsp2bBlueprint(id, (u, init) => fetch(u, init));
    fetching.value = false;
    if (r.kind !== 'ok') {
        sourceError.value = { kind: r.kind === 'not_found' ? 'dsp2bNotFound' : 'dsp2bUnreachable', params: {} };
        return;
    }
    if (await session.open(r.code))
        dsp2bId.value = id;
});
const codeExpired = ref(false);
const selectedBuildingIndex = ref(null as number | null);
/** 每打开一个蓝图加一，侧栏据此重建（子组件在 setup 时取 commandQueue） */
const openCount = ref(0);

const commandQueue = computed(() => {
    if (data.value === null)
        return null;
    return new CommandQueue(data.value);
});
provide(commandQueueKey, commandQueue);

watch(codeExpired, expired => { if (expired) session.markDirty(); });

watchEffect(onCleanup => {
    if (commandQueue.value) {
        const stopWatch = watch(commandQueue.value.execVersion, () => codeExpired.value = true);
        onCleanup(stopWatch);
    }
});

const selectedBuilding = computed(() => {
    if (data.value === null || selectedBuildingIndex.value === null)
        return null;
    return data.value.buildings[selectedBuildingIndex.value] ?? null;
})
const buildingInfo = computed(() => {
    if (data.value === null)
        return null;
    return new BuildingInfo(data.value.buildings);
})
provide(buildingInfoKey, buildingInfo);

const encodeBp = () => {
    if (!codeExpired.value || !data.value)
        return;
    bpStr.value = toStr(data.value)
    codeExpired.value = false;
}
const bpStrLatest = () => {
    encodeBp();
    return bpStr.value;
}

const bpStrInput = ref('');
const bpStrDisplay = () => {
    if (codeExpired.value)
        return 'BLUEPRINT:...';
    const len = bpStr.value.length
    if (len < 1000)
        return bpStr.value;
    return bpStr.value.substring(0, 400) + '\n...\n' + bpStr.value.substring(len - 400, len);
}
watchEffect(() => {
    bpStrInput.value = bpStrDisplay();
});

let stopDataWatch: (() => void) | null = null;
session.onOpened(parsed => {
    stopDataWatch?.();
    stopDataWatch = watch(parsed, () => codeExpired.value = true);
    selectedBuildingIndex.value = null;
    bpStr.value = session.input.value.trim();
    codeExpired.value = false;
    openCount.value++;
    gtag('event', 'bp_parse', {
        'bp_length': bpStr.value.length,
    })
});

/** 用户自己打开的蓝图（粘贴、文件、最近）：成功后不再属于 dsp2b */
const openOwn = async (s: string) => {
    sourceError.value = null;
    const ok = await session.open(s);
    if (ok)
        forgetDsp2b();
    return ok;
};
const openCode = openOwn;

const clearBp = () => {
    stopDataWatch?.();
    stopDataWatch = null;
    session.close();
    forgetDsp2b();
    selectedBuildingIndex.value = null;
    bpStr.value = '';
    codeExpired.value = false;
}

/** 换蓝图：回到空状态卡片；有未导出的修改先确认 */
const switchBp = () => {
    if (session.dirty.value && !window.confirm(t('确认替换')))
        return;
    clearBp();
}

/** 修改已经导出（复制或保存）后，不再算作未保存 */
const markExported = () => { session.dirty.value = false; };

const copy = async () => {
    busy.value = true;
    try {
        await navigator.clipboard.writeText(bpStrLatest());
        markExported();
        return true;
    } catch {
        alert(t('复制粘贴不支持'));
        return false;
    } finally {
        busy.value = false;
    }
}

const saveFile = () => {
    if (!data.value)
        return;
    const url = URL.createObjectURL(new Blob([bpStrLatest()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = (data.value.header.shortDesc.trim() || 'blueprint') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 等浏览器开始下载后再释放
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markExported();
}

const openFile = async (f: File) => {
    busy.value = true;
    try {
        await openOwn(await f.text());
    } finally {
        busy.value = false;
    }
}

const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files'))
        return;
    e.preventDefault();
    dragging.value = true;
}

const onDrop = (e: DragEvent) => {
    dragging.value = false;
    const f = e.dataTransfer?.files[0];
    if (!f)
        return;
    e.preventDefault();
    openFile(f);
}

// 渲染器只在窗口尺寸变化时调整画布；侧栏出现/消失会改变视图宽度，这里补发一次
const view = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || !view.value)
        return;
    let first = true;
    resizeObserver = new ResizeObserver(() => {
        if (first) {
            first = false;
            return;
        }
        nextTick(() => window.dispatchEvent(new Event('resize')));
    });
    resizeObserver.observe(view.value);
});
onUnmounted(() => resizeObserver?.disconnect());

const hotkey = (event: KeyboardEvent) => {
    if (event.isComposing)
        return;
    if (event.ctrlKey && !event.altKey) {
        if (event.code === 'KeyZ') {
            if (event.shiftKey)
                commandQueue.value?.redo();
            else
                commandQueue.value?.undo();
        } else if (event.code === 'KeyY' && !event.shiftKey) {
            commandQueue.value?.redo();
        }
    }
}
onMounted(() => document.body.addEventListener('keydown', hotkey));
onUnmounted(() => document.body.removeEventListener('keydown', hotkey));

// 已打开蓝图时在页面上粘贴：替换当前蓝图（有未保存的修改先确认）；空状态由卡片的输入框处理
const onPagePaste = (e: ClipboardEvent) => {
    if (!data.value || working.value)
        return;
    const text = pastedText(e);
    if (text === null)
        return;
    e.preventDefault();
    openOwn(text);
}
onMounted(() => document.addEventListener('paste', onPagePaste));
onUnmounted(() => document.removeEventListener('paste', onPagePaste));
</script>

<style lang="scss">
body {
    width: 100vw;
    height: 100vh;
}

.app {
    display: grid;
    grid-template-columns: 1fr;
    width: 100vw;
    height: 100vh;

    &.loaded {
        grid-template-columns: minmax(0, 1fr) var(--side);
    }
}

.view {
    position: relative;
    min-width: 0;
    overflow: hidden;
    background: radial-gradient(120% 90% at 40% 0%, #16253B 0%, var(--void) 45%, var(--deep) 100%);
}

.float-settings {
    position: absolute;
    right: 12px;
    top: 12px;
    z-index: 5;
}

@media (max-width: 760px) {
    .app.loaded {
        grid-template-columns: 1fr;
    }
    // 空状态只显示卡片
    .float-settings {
        display: none;
    }
}
</style>

<i18n>
{
    zh: {
        "复制粘贴不支持": "不支持，请手动复制",
        "确认替换": "当前蓝图有未保存的修改，打开新蓝图会丢弃这些修改。继续吗？",
        "三维预览": "蓝图三维预览",
        "三维预览说明": "蓝图的三维预览：拖动旋转，滚轮或双指缩放，点击建筑在侧栏查看详情。"
    },
    en: {
        "复制粘贴不支持": "Not supported, please copy manually",
        "确认替换": "The current blueprint has unsaved edits. Opening another one discards them. Continue?",
        "三维预览": "Blueprint 3D preview",
        "三维预览说明": "3D preview of the blueprint: drag to rotate, scroll or pinch to zoom, click a building to see its details in the sidebar."
    },
}
</i18n>
