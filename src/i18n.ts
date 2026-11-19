import { createI18n } from 'vue-i18n'

import zh from './locales/zh.json'
import en from './locales/en.json'
import { Ref, ref, watchEffect } from 'vue'
import { itemsMap, recipesMap } from './data'

// Node < 21（如 CI 的 Node 20 下跑 jest）没有全局 navigator，模块加载时不能直接访问
const browserLanguages: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages : [];

const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: [...browserLanguages, 'en'],
    messages: {
      zh,
      en,
    },
});

export function useLang() {
    const lang: Ref<'auto' | typeof i18n.global.locale.value> = ref('auto');

    watchEffect(() => {
        const locale = i18n.global.locale;
        if (lang.value === 'auto') {
            // if navigator language is not supported, fallback will be used
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            locale.value = (browserLanguages[0] ?? 'en') as any;
        } else {
            locale.value = lang.value;
        }
    })

    return lang;
}

export default i18n;

export function itemName(id: number) {
    const item = itemsMap.get(id);
    return item ? i18n.global.t(item.name) : 'unknown';
}

export function recipeName(id: number) {
    const r = recipesMap.get(id);
    return r ? i18n.global.t(r.name) : 'unknown';
}
