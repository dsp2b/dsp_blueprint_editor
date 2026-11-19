import { ref, shallowRef } from 'vue';
import type { BlueprintData, FromStrOptions } from '@/blueprint/parser';
import { mapParseError, ParseErrorInfo } from './errorMap';
import type { RecentEntry, RecentStore } from './recentStore';

/** 解析超过该时长才在卡片里显示进度 */
export const LOADING_DELAY_MS = 300;

export interface ParseOptions extends FromStrOptions {
    /** 被更新的打开或关闭取代时中止（Worker 解析据此终止 Worker） */
    signal?: AbortSignal;
}

export interface SessionDeps {
    parse: (code: string, options: ParseOptions) => BlueprintData | Promise<BlueprintData>;
    store: RecentStore;
    /** 当前支持的游戏版本 */
    supported: string;
    /** 有未保存编辑时替换蓝图前询问，返回 false 放弃替换 */
    confirmReplace: () => boolean | Promise<boolean>;
}

/**
 * 打开蓝图的会话：当前蓝图、输入内容、加载进度、错误、未保存标记、最近列表。
 * 渲染器通过 onOpened 在成功打开后收到数据，用来对准相机。
 */
export function useBlueprintSession(deps: SessionDeps) {
    const data = shallowRef<BlueprintData | null>(null);
    const input = ref('');
    const error = ref<ParseErrorInfo | null>(null);
    const dirty = ref(false);
    const loading = ref({ active: false, visible: false, done: 0, total: 0 });
    const recent = ref<RecentEntry[]>([]);
    const openedListeners = new Set<(d: BlueprintData) => void>();
    let seq = 0;
    let inflight: AbortController | null = null;
    const abortInflight = () => {
        inflight?.abort();
        inflight = null;
    };

    const refreshRecent = async () => {
        try {
            recent.value = await deps.store.list();
        } catch (e) {
            console.warn('recent blueprints unavailable', e);
            recent.value = [];
        }
    };

    const open = async (code: string): Promise<boolean> => {
        const text = code.trim();
        if (!text)
            return false;
        if (data.value && dirty.value && !(await deps.confirmReplace()))
            return false;

        const mine = ++seq;
        abortInflight();
        const ac = inflight = new AbortController();
        input.value = code;
        error.value = null;
        loading.value = { active: true, visible: false, done: 0, total: 0 };
        const timer = setTimeout(() => {
            if (mine === seq)
                loading.value = { ...loading.value, visible: true };
        }, LOADING_DELAY_MS);
        try {
            const parsed = await deps.parse(text, {
                signal: ac.signal,
                onProgress: (done, total) => {
                    if (mine === seq)
                        loading.value = { ...loading.value, done, total };
                },
            });
            if (mine !== seq)
                return false;
            if (inflight === ac)
                inflight = null;
            data.value = parsed;
            dirty.value = false;
            loading.value = { active: false, visible: false, done: 0, total: 0 };
            // 在任何 await 之前通知：此刻 data 与 input 一致，之后可能已有新的打开在进行
            openedListeners.forEach(l => l(parsed));
            try {
                await deps.store.add({
                    code: text,
                    name: parsed.header.shortDesc,
                    // 解析结果的 header 是响应式代理，IndexedDB 无法结构化克隆它
                    icons: [...parsed.header.icons],
                });
            } catch (e) {
                console.warn('cannot save recent blueprint', e);
            }
            await refreshRecent();
            return true;
        } catch (e) {
            if (mine !== seq)
                return false;
            if (inflight === ac)
                inflight = null;
            console.error(e);
            error.value = mapParseError(e, text, deps.supported);
            loading.value = { active: false, visible: false, done: 0, total: 0 };
            return false;
        } finally {
            clearTimeout(timer);
        }
    };

    const close = () => {
        seq++;
        abortInflight();
        data.value = null;
        input.value = '';
        error.value = null;
        dirty.value = false;
        loading.value = { active: false, visible: false, done: 0, total: 0 };
    };

    const clearRecent = async () => {
        try {
            await deps.store.clear();
        } catch (e) {
            console.warn(e);
        }
        recent.value = [];
    };

    const onOpened = (l: (d: BlueprintData) => void) => {
        openedListeners.add(l);
        return () => { openedListeners.delete(l); };
    };

    void refreshRecent();

    return {
        data, input, error, dirty, loading, recent,
        open, close, clearRecent, refreshRecent, onOpened,
        markDirty: () => { dirty.value = true; },
    };
}
