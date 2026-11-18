<template>
    <div class="container" @dragover="onDragOver" @dragleave="dragging = false" @drop="onDrop">
        <BlueprintEditor ref="renderer"
            v-model:selectedBuildingIndex="selectedBuildingIndex"
            @update:selectedBuildingIndex="i => buildingFocused(i !== null)" />
        <OpenCard v-if="!data"
            v-model:input="session.input.value"
            :error="session.error.value" :loading="session.loading.value"
            :recent="session.recent.value" :supported="supportedGameVersion" :dragging="dragging"
            @open="openCode" @clear-recent="session.clearRecent()" />
        <div v-if="!data" class="lang-float">
            <label for="select-language-empty"><img src="@/assets/icons/translate.svg" alt="Languages"></label>
            <select id="select-language-empty" v-model="lang">
                <option value="auto">{{t('自动选择语言')}}</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
            </select>
        </div>
        <div v-if="data" class="sidebar" :class="{ expanded: expandSidebar }">
            <div>
                <div class="info-tab tab"
                    :class="{ active: activeTab === 'info'}"
                    @click="activeTab = 'info'"></div>
                <div class="operations-tab tab"
                    :class="{ active: activeTab === 'operations'}"
                    @click="activeTab = 'operations'"></div>
            </div>
            <div v-if="activeTab === 'info'">
                <section style="display: flex; flex-direction: row; gap: 5px;">
                    <div>
                        <label for="iconLayout">{{t('图标布局')}}</label>
                        <select id="iconLayout" :disabled="!data"
                                v-model="iconLayout">
                            <option v-for="[id, s] of allIconLayouts" :key="id" :value="id">{{s}}</option>
                        </select>
                        <label for="shortDesc">{{t('缩略图文字')}}</label>
                        <input type="text" id="shortDesc" :disabled="!data"
                            :value="data?.header.shortDesc"
                            @input="e => data!.header.shortDesc = (e.target as HTMLInputElement).value">
                    </div>
                    <BlueprintIcon style="height: 90px; flex: none;" :layout-id="iconLayout" :icons="data?.header.icons"/>
                </section>
                <section>
                    <label for="desc">{{t('蓝图介绍')}}</label>
                    <textarea rows="2" id="desc" :disabled="!data"
                            :value="data?.header.desc"
                            @input="e => data!.header.desc = (e.target as HTMLInputElement).value"
                    ></textarea>
                </section>
                <section>
                    <div class="row">
                        <label for="bp-str" style="margin-right: auto;">{{ t('蓝图代码') }}</label>
                        <button style="margin-left: 4px;" @click="copy" :disabled="working || !bpStr">{{ t('复制') }}</button>
                        <button style="margin-left: 4px;" @click="paste" :disabled="working">{{ t('粘贴') }}</button>
                    </div>
                    <textarea class="bp-code" rows="3" id="bp-str" v-model="bpStrInput"
                            @copy="onCopy" @cut="onCut" @paste="onPaste"
                            @focus="encodeBp" @change="e => openCode((e.target as HTMLTextAreaElement).value)">
                    </textarea>
                    <div class="row" style="align-items: stretch; column-gap: 4px;">
                        <button @click="clearBp" :disabled="working"
                                style="position: relative; flex: auto; width: 50px;" >
                            {{ bpStr ? t("清空") : t("选择文件") }}
                            <input v-if="!bpStr" @change="onBpFile" :disabled="working"
                                type="file" accept="text/plain" id="blueprint-file"
                                style="position: absolute; inset: 0; opacity: 0;" />
                        </button>
                        <a v-if="bpStr && data" class="button" @click="prepareSave"
                            :href="bpUrl" :download="data.header.shortDesc + '.txt'"
                            style="flex: auto; width: 50px;" >
                            {{ t("保存文件") }}
                        </a>
                    </div>
                    <OpenError v-if="session.error.value" :error="session.error.value" />
                </section>
                <section>
                    <div class="row">
                        <span style="margin-right: auto;">{{t('创建版本号')}}</span>
                        <span>{{ data?.header.gameVersion }}</span>
                    </div>
                    <div class="row">
                        <span style="margin-right: auto;">{{t('创建时间')}}</span>
                        <span>{{ data?.header.time.toLocaleString([], { timeZone: 'UTC' }) }}</span>
                    </div>
                </section>
                <section>
                    <BuildingInfoPanel v-if="selectedBuilding !== null" :building="selectedBuilding" />
                    <BuildingOverview v-else-if="data" />
                </section>
            </div>
            <ul class="operations" v-else-if="activeTab === 'operations'">
                <template v-if="data && commandQueue">
                    <li>
                        <button @click="replaceModal!.open()">
                            <img src="@/assets/icons/find_replace.svg">
                            {{ t('批量替换') }}
                        </button>
                        <ReplaceModal :blueprint="data" ref="replaceModal"/>
                    </li>
                    <li>
                        <button @click="commandQueue!.undo()" :disabled="!commandQueue.canUndo()">
                            <img src="@/assets/icons/undo.svg">
                            {{ t('撤销') }}
                        </button>
                    </li>
                    <li>
                        <button @click="commandQueue!.redo()" :disabled="!commandQueue.canRedo()">
                            <img src="@/assets/icons/redo.svg">
                            {{ t('重做') }}
                        </button>
                    </li>
                </template>
                <li style="margin-top: auto;">
                    <div class="select-li">
                        <label for="select-language">
                            <img src="@/assets/icons/translate.svg">
                            Languages
                        </label>
                        <select id="select-language" v-model="lang">
                            <option value="auto">{{t('自动选择语言')}}</option>
                            <option value="en">English</option>
                            <option value="zh">中文</option>
                        </select>
                    </div>
                </li>
            </ul>
            <footer>
                {{ version }}<SWStatus />
            </footer>
        </div>
        <button v-if="data" class="expand-btn" :aria-label="t('侧边栏')" :class="{ expanded: expandSidebar }"
                @click="expandSidebar = !expandSidebar" ></button>
    </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, reactive, ref, shallowReactive, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { fromStr, toStr } from '@/blueprint/parser';
import { supportedGameVersion } from '@/data/types';
import { useBlueprintSession } from '@/open/session';
import { createWorkerParser, WorkerLike } from '@/open/workerParser';
import { createRecentStore } from '@/open/recentStore';
import { sessionKey } from '@/open/keys';
import OpenCard from './components/open/OpenCard.vue';
import OpenError from './components/open/OpenError.vue';
import { version, rendererKey, buildingInfoKey, commandQueueKey } from '@/define';
import { BuildingInfo } from './blueprint/buildingInfo';

import BuildingInfoPanel from './components/BuildingInfoPanel.vue';
import SWStatus from '@/swStatus.vue';
import BlueprintIcon from './components/BlueprintIcon.vue';
import ReplaceModal from './components/ReplaceModal.vue';
import { CommandQueue } from './command';
import BuildingOverview from './components/BuildingOverview.vue';
import { useLang } from './i18n';
const BlueprintEditor = defineAsyncComponent(() => import(/* webpackChunkName: "renderer" */'./components/BlueprintEditor.vue'));

const { t } = useI18n();
const lang = useLang();

const renderer = ref<null | InstanceType<typeof BlueprintEditor>>(null);
const replaceModal = ref<null | InstanceType<typeof ReplaceModal>>(null);
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
const expandSidebar = ref(true);
const activeTab = ref<'info' | 'operations'>('info')
const busy = ref(false);
const working = computed(() => busy.value || session.loading.value.active);
const codeExpired = ref(false);
const selectedBuildingIndex = ref(null as number | null);

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

const buildingFocused = (selected: boolean) => {
    expandSidebar.value = selected;
    if (selected)
        activeTab.value = 'info';
}

const selectedBuilding = computed(() => {
    if (data.value === null || selectedBuildingIndex.value === null)
        return null;
    return data.value.buildings[selectedBuildingIndex.value];
})
const buildingInfo = computed(() => {
    if (data.value === null)
        return null;
    return new BuildingInfo(data.value.buildings);
})
provide(buildingInfoKey, buildingInfo);

const allIconLayouts = new Map<number, string>([
    [ 1, '无'],
    [10, '1-1'], [11, '1-2'],
    [20, '2-1'], [21, '2-2'], [22, '2-3'], [23, '2-4'], [24, '2-5'],
    [30, '3-1'], [31, '3-2'], [32, '3-3'], [33, '3-4'],
    [40, '4-1'], [41, '4-2'],
    [50, '5-1'], [51, '5-2'],
]);
const iconLayout = computed<number>({
    get() { return data.value?.header.layout ?? 0; },
    set(v) { data.value!.header.layout = v; },
})

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

const bpUrl = ref('');
watchEffect(() => {
    if (codeExpired.value && bpUrl.value) {
        URL.revokeObjectURL(bpUrl.value);
        bpUrl.value = '';
    }
})
const prepareSave = () => {
    if (!bpUrl.value) {
        bpUrl.value = URL.createObjectURL(new Blob([bpStrLatest()], { type: 'text/plain' }));
    }
}
onUnmounted(() => {
    if (bpUrl.value) {
        URL.revokeObjectURL(bpUrl.value);
        bpUrl.value = '';
    }
})

let stopDataWatch: (() => void) | null = null;
session.onOpened(parsed => {
    stopDataWatch?.();
    stopDataWatch = watch(parsed, () => codeExpired.value = true);
    selectedBuildingIndex.value = null;
    bpStr.value = session.input.value.trim();
    codeExpired.value = false;
    gtag('event', 'bp_parse', {
        'bp_length': bpStr.value.length,
    })
});

const openCode = (s: string) => session.open(s);

const clearBp = () => {
    stopDataWatch?.();
    stopDataWatch = null;
    session.close();
    selectedBuildingIndex.value = null;
    bpStr.value = '';
    codeExpired.value = false;
}

const openFile = async (f: File) => {
    busy.value = true;
    try {
        await session.open(await f.text());
    } finally {
        busy.value = false;
    }
}

const onBpFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0])
        await openFile(input.files[0]);
    input.value = '';
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

const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', bpStrLatest());
}

const onCut = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', bpStrLatest());
    clearBp();
}

const onPaste = (e: ClipboardEvent) => {
    if (!e.clipboardData)
        return;
    e.preventDefault();
    (e.target as HTMLElement).blur();
    openCode(e.clipboardData.getData('text/plain'));
}

const copy = async () => {
    busy.value = true;
    try {
        await navigator.clipboard.writeText(bpStrLatest());
    } catch {
        alert(t('复制粘贴不支持'));
    }
    busy.value = false;
}

const paste = async () => {
    busy.value = true;
    let text = '';
    try {
        text = await navigator.clipboard.readText();
    } catch {
        alert(t('复制粘贴不支持'));
    }
    busy.value = false;
    if (text)
        await openCode(text);
}

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
</script>

<style lang="scss">
body {
    margin: 0;
    background: black;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
        Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
}

.container {
    width: 100vw;
    height: 100vh;
    position: relative;
}

.expand-btn {
    position: absolute;
    right: 0;
    top: 0;
    height: 60px;
    width: 60px;
    background: url(@/assets/icons/menu.svg) center no-repeat, #00000060;
    border: 0;

    &.expanded {
        background: url(@/assets/icons/close.svg) center no-repeat;
    }
}

.tab {
    height: 60px;
    width: 60px;
    opacity: 0.5;
    display: inline-block;

    &.active {
        opacity: 1.0;
    }
}
.info-tab {
    background: url(@/assets/icons/menu.svg) center no-repeat;
}
.operations-tab {
    background: url(@/assets/icons/settings.svg) center no-repeat;
}

.row {
    display: flex;
    flex-direction: row;
    align-items: baseline;
}

.sidebar {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    overflow-y: auto;
    box-sizing: border-box;
    background: #000000b0;
    color: white;
    display: none;
    padding-left: 10px;
    padding-right: 10px;

    @media screen and (max-width: 360px) {
        width: 100%;
    }

    section {
        margin: 5px 0;
    }

    footer {
        margin-top: auto;
        margin-bottom: 5px;
        color: gray;
    }

    &.expanded {
        display: flex;
        flex-direction: column;
    }

    button,
    .button {
        color: inherit;
        background: #64a0dc;
        border: 0;
        box-sizing: border-box;
        font-size: 0.9rem;
        padding: 1px 4px;
        margin: 0;
        text-decoration: none;
        text-align: center;
        user-select: none;
        cursor: pointer;

        &[disabled] {
            background: gray;
            cursor: default;
        }
    }

    textarea, input[type="text"], select {
        background: #ffffff40;
        border: 0;
        width: 100%;
        font-size: 0.9rem;
        box-sizing: border-box;
        resize: none;
        color: inherit;
        &:focus {
            background: #4f6671;
        }
    }

    .bp-code {
        word-break: break-all;
    }
}

.lang-float {
    position: absolute;
    right: 12px;
    top: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    select { background: #121e30; color: #e6eefb; border: 1px solid #2a3f5c; border-radius: 6px; padding: 4px; }
}

ul.operations {
    padding: 0;
    display: flex;
    flex-direction: column;
    flex: auto;
    >li {
        display: block;
        list-style: none;
        border-bottom: 1px solid #fff6;
        margin: 0;

        button, .select-li {
            box-sizing: border-box;
            padding: 5px;
            color: white;
            width: 100%;
            background: transparent;
            text-align: start;

            &[disabled] {
                background: transparent;
                opacity: 0.5;
            }
        }
        img {
            vertical-align: middle;
        }
    }
}

.select-li {
    display: flex;
    >select {
        margin-left: 5px;
        flex: 1 100px;
    }
}
</style>

<i18n>
{
    zh: {
        "复制": "复制",
        "粘贴": "粘贴",
        "选择文件": "选择文件",
        "清空": "清空",
        "复制粘贴不支持": "不支持，请手动复制",
        "保存文件": "保存文件",

        "确认替换": "当前蓝图有未保存的修改，打开新蓝图会丢弃这些修改。继续吗？",
        "侧边栏": "侧边栏",
        "批量替换": "批量替换",
        "撤销": "撤销",
        "重做": "重做",
        "自动选择语言": "自动选择"
    },
    en: {
        "复制": "Copy",
        "粘贴": "Paste",
        "选择文件": "Select File",
        "清空": "Clear",
        "复制粘贴不支持": "Not supported, please copy manually",
        "保存文件": "Save File",

        "确认替换": "The current blueprint has unsaved edits. Opening another one discards them. Continue?",
        "侧边栏": "Sidebar",
        "批量替换": "Batch Replace",
        "撤销": "Undo",
        "重做": "Redo",
        "自动选择语言": "Auto Select"
    },
}
</i18n>
