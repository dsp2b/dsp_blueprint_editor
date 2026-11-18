/** 真实模型下载进度提示的文案；运行时合并进全局 vue-i18n（见 index.ts） */
export const modelPillMessages = {
    zh: {
        modelPill: {
            loading: '正在下载建筑模型 {done}/{total}（{loaded} / {size} MB）',
            loadingFailed: '正在下载建筑模型 {done}/{total}（{loaded} / {size} MB），{failed} 种失败',
            failed: '{failed} 种建筑模型下载失败，仍显示为方盒',
            retry: '重试',
        },
    },
    en: {
        modelPill: {
            loading: 'Downloading building models {done}/{total} ({loaded} / {size} MB)',
            loadingFailed: 'Downloading building models {done}/{total} ({loaded} / {size} MB), {failed} failed',
            failed: '{failed} building model failed to download and stays a box | {failed} building models failed to download and stay boxes',
            retry: 'Retry',
        },
    },
};
