<template>
    <aside class="side" :class="{ collapsed: sheetCollapsed }" :aria-label="t('蓝图信息')">
        <div class="sheet-top" @pointerdown="onSwipeStart" @pointerup="onSwipeEnd" @pointercancel="swipeY = null">
            <button type="button" class="sheet-handle" :aria-label="t('展开或收起')"
                    :aria-expanded="!sheetCollapsed" @click="collapsed = !collapsed"></button>
            <SidebarHeader :header="data.header" :building-count="data.buildings.length"
                           :disabled="disabled" :copy="copy"
                           @save="emit('save')" @switch="emit('switch')"
                           @settings-open="collapsed = false" />
            <div v-if="$slots.notice" class="notice"><slot name="notice"></slot></div>
        </div>

        <div class="sheet-body" :inert="sheetCollapsed || undefined">
            <div class="tabs" role="tablist" :aria-label="t('蓝图信息')" @keydown="onTabKey">
                <button v-for="tab of tabs" :key="tab" type="button" role="tab" class="tab"
                        :id="`tab-${tab}`" :aria-controls="`pane-${tab}`"
                        :aria-selected="activeTab === tab" :tabindex="activeTab === tab ? 0 : -1"
                        @click="activeTab = tab">
                    {{ t(tabLabels[tab]) }}<span v-if="tab === 'building' && selectedBuilding" class="badge">1</span>
                </button>
            </div>

            <div class="panes">
                <section v-show="activeTab === 'overview'" id="pane-overview" class="pane" role="tabpanel"
                         aria-labelledby="tab-overview" tabindex="0">
                    <slot name="overview">
                        <OverviewTab :data="data" />
                    </slot>
                </section>
                <section v-show="activeTab === 'building'" id="pane-building" class="pane" role="tabpanel"
                         aria-labelledby="tab-building" tabindex="0">
                    <BuildingTab :building="selectedBuilding" />
                </section>
                <section v-show="activeTab === 'edit'" id="pane-edit" class="pane" role="tabpanel"
                         aria-labelledby="tab-edit" tabindex="0">
                    <EditTab :code="code" :get-code="getCode" />
                </section>
            </div>
            <footer class="side-foot"><span>{{ version }}</span><SWStatus /></footer>
        </div>
    </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import { version } from '@/define';
import SWStatus from '@/swStatus.vue';
import OverviewTab from './OverviewTab.vue';
import SidebarHeader from './SidebarHeader.vue';
import BuildingTab from './BuildingTab.vue';
import EditTab from './EditTab.vue';

type Tab = 'overview' | 'building' | 'edit';
const tabs: Tab[] = ['overview', 'building', 'edit'];
const tabLabels: Record<Tab, string> = { overview: '概览', building: '建筑', edit: '编辑' };

/** 与样式里的移动端断点一致 */
const MOBILE_QUERY = '(max-width: 760px)';
/** 上下滑动超过这个距离才算展开/收起 */
const SWIPE_PX = 36;

const props = defineProps<{
    data: BlueprintData,
    selectedBuilding: BlueprintBuilding | null,
    code: string,
    getCode: () => string,
    copy: () => Promise<boolean>,
    disabled?: boolean,
}>();
const emit = defineEmits<{
    (e: 'save'): void,
    (e: 'switch'): void,
}>();

const { t } = useI18n();

const activeTab = ref<Tab>('overview');

// 移动端是底部抽屉，默认收起；桌面端始终展开
const mobile = ref(false);
const collapsed = ref(true);
const sheetCollapsed = computed(() => mobile.value && collapsed.value);
let mql: MediaQueryList | null = null;
const onMedia = () => { mobile.value = !!mql?.matches; };
onMounted(() => {
    mql = window.matchMedia(MOBILE_QUERY);
    onMedia();
    mql.addEventListener('change', onMedia);
});
onUnmounted(() => mql?.removeEventListener('change', onMedia));

// 选中建筑时自动展开到建筑页
watch(() => props.selectedBuilding, b => {
    if (b) {
        activeTab.value = 'building';
        collapsed.value = false;
    }
});

const swipeY = ref<number | null>(null);
const onSwipeStart = (e: PointerEvent) => {
    if (mobile.value && e.pointerType !== 'mouse')
        swipeY.value = e.clientY;
};
const onSwipeEnd = (e: PointerEvent) => {
    if (swipeY.value === null)
        return;
    const dy = e.clientY - swipeY.value;
    swipeY.value = null;
    if (dy < -SWIPE_PX)
        collapsed.value = false;
    else if (dy > SWIPE_PX)
        collapsed.value = true;
};

// 标签页：左右方向键、Home/End 切换
const onTabKey = async (e: KeyboardEvent) => {
    const i = tabs.indexOf(activeTab.value);
    const next = {
        ArrowRight: (i + 1) % tabs.length,
        ArrowLeft: (i + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
    }[e.key];
    if (next === undefined)
        return;
    e.preventDefault();
    activeTab.value = tabs[next];
    await nextTick();
    document.getElementById(`tab-${tabs[next]}`)?.focus();
};
</script>

<style lang="scss" scoped>
.side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
    border-left: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
}
.sheet-handle { display: none; }
.notice { padding: 0 18px 12px; }
.sheet-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.tabs {
    display: flex;
    gap: 4px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
}
.tab {
    position: relative;
    padding: 10px 10px 11px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    &:hover { color: var(--text); }
    &[aria-selected="true"] {
        color: var(--text);
        &::after {
            content: "";
            position: absolute;
            left: 8px;
            right: 8px;
            bottom: -1px;
            height: 2px;
            border-radius: 1px;
            background: var(--holo);
        }
    }
    &:focus-visible { outline-offset: -2px; }
    .badge { margin-left: 4px; font: 11px var(--num); color: var(--holo); }
}

.panes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--panel-3) transparent;
}
.pane {
    padding: 16px 18px 28px;
    &:focus-visible { outline-offset: -2px; }
    :deep(h2) { margin: 0 0 10px; font: 600 13px/1.4 var(--cjk); color: var(--muted); }
    :deep(h3:not(.detail-name)) { margin: 18px 0 8px; color: var(--muted); font-size: 13px; }
}

.side-foot {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 18px;
    border-top: 1px solid var(--line);
    font: 11px var(--num);
    color: var(--faint);
}

@media (max-width: 760px) {
    .side {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: var(--sheet-h);
        border-left: 0;
        border-top: 1px solid var(--line);
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -16px 40px rgba(0, 0, 0, .45);
        transition: transform .28s ease;
        z-index: 10;
        &.collapsed { transform: translateY(calc(var(--sheet-h) - var(--sheet-peek))); }
    }
    .sheet-top { touch-action: none; }
    .sheet-handle {
        display: block;
        width: 100%;
        height: 22px;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
        &::before {
            content: "";
            display: block;
            width: 40px;
            height: 4px;
            margin: 8px auto 0;
            border-radius: 2px;
            background: var(--panel-3);
        }
        &:focus-visible { outline-offset: -2px; }
    }
}
@media (prefers-reduced-motion: reduce) {
    .side { transition: none; }
}
</style>

<i18n>
{
    "zh": {
        "蓝图信息": "蓝图信息",
        "展开或收起": "展开或收起蓝图信息",
        "概览": "概览",
        "建筑": "建筑",
        "编辑": "编辑"
    },
    "en": {
        "蓝图信息": "Blueprint info",
        "展开或收起": "Expand or collapse blueprint info",
        "概览": "Overview",
        "建筑": "Building",
        "编辑": "Edit"
    }
}
</i18n>
