import { InjectionKey, reactive, watch } from 'vue';

/** 'box' 为精简模式（方盒 + 图标），'model' 为真实模型 */
export type DisplayMode = 'box' | 'model';
export type DefaultMode = 'auto' | DisplayMode;
export type Lang = 'auto' | 'zh' | 'en';

export interface Settings {
    lang: Lang;
    /** 设置里选的默认显示模式 */
    defaultMode: DefaultMode;
    /** 上次手动切换的模式，没切换过为 null */
    viewMode: DisplayMode | null;
    grid: boolean;
    flow: boolean;
    badges: boolean;
}

/** navigator.connection 里用得到的部分 */
export interface ConnectionInfo {
    saveData?: boolean;
    effectiveType?: string;
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'dsp-bp-settings';
export const settingsKey = Symbol('settings') as InjectionKey<Settings>;

const SLOW_TYPES = new Set(['slow-2g', '2g', '3g']);

/**
 * 决定打开蓝图时用哪种显示模式：明确选了精简/真实模型就用它；
 * 选自动时，手动切换过的模式优先，否则省流量或 2g/3g 用精简，其余用真实模型。
 */
export function resolveDisplayMode(
    conn: ConnectionInfo | null | undefined,
    pref: Pick<Settings, 'defaultMode' | 'viewMode'>,
): DisplayMode {
    if (pref.defaultMode !== 'auto')
        return pref.defaultMode;
    if (pref.viewMode)
        return pref.viewMode;
    if (conn?.saveData || (conn?.effectiveType && SLOW_TYPES.has(conn.effectiveType)))
        return 'box';
    return 'model';
}

export function defaultSettings(): Settings {
    return { lang: 'auto', defaultMode: 'auto', viewMode: null, grid: true, flow: true, badges: true };
}

const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? v as T : fallback;
const bool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;

function load(storage: StorageLike | null): Settings {
    const d = defaultSettings();
    let raw: Record<string, unknown> = {};
    try {
        const text = storage?.getItem(SETTINGS_KEY);
        const parsed = text ? JSON.parse(text) : null;
        if (parsed && typeof parsed === 'object')
            raw = parsed;
    } catch {
        // 存储不可用或内容损坏时用默认值
    }
    return {
        lang: oneOf(raw.lang, ['auto', 'zh', 'en'] as const, d.lang),
        defaultMode: oneOf(raw.defaultMode, ['auto', 'box', 'model'] as const, d.defaultMode),
        viewMode: oneOf(raw.viewMode, ['box', 'model', null] as const, d.viewMode),
        grid: bool(raw.grid, d.grid),
        flow: bool(raw.flow, d.flow),
        badges: bool(raw.badges, d.badges),
    };
}

/** 响应式设置，修改后自动写回存储（浏览器里传 localStorage） */
export function createSettings(storage: StorageLike | null): Settings {
    const settings = reactive(load(storage));
    watch(settings, s => {
        try {
            storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
        } catch (e) {
            console.warn('cannot save settings', e);
        }
    }, { deep: true });
    return settings;
}

/** 取 localStorage；隐私模式等情况下访问会抛错 */
export function browserStorage(): StorageLike | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/** 取浏览器报告的网络信息（不支持时为 undefined） */
export function browserConnection(): ConnectionInfo | undefined {
    if (typeof navigator === 'undefined')
        return undefined;
    return (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}
