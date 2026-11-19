import { progressText } from '@/render/real/loader';
import { globalTranslate } from '@/render/real';

/** 生产构建配置了 vue-i18n runtimeOnly（runtime 包不注册消息编译器）：运行时合并的字符串模板不会被编译，t 只返回键名；测试里同样不注册编译器 */
jest.mock('@intlify/core-base', () => ({
    ...jest.requireActual('@intlify/core-base'),
    registerMessageCompiler: () => undefined,
}));

describe('模型下载进度提示（走应用同一条 vue-i18n 路径）', () => {
    const cases: [string, string, string][] = [
        ['zh', 'loading', '正在下载建筑模型 2/4（0.4 / 1.1 MB）'],
        ['en', 'loading', 'Downloading building models 2/4 (0.4 / 1.1 MB)'],
        ['zh', 'failed', '2 种建筑模型下载失败，仍显示为方盒'],
        ['en', 'failed', '2 building models failed to download and stay boxes'],
    ];
    it.each(cases)('%s %s', async (lang, state, expected) => {
        const { default: i18n } = await import('@/i18n');
        const t = await globalTranslate();
        (i18n.global.locale as unknown as { value: string }).value = lang;
        const p = state === 'loading'
            ? { done: 2, total: 4, failed: 0, loadedBytes: 400000, totalBytes: 1100000 }
            : { done: 2, total: 4, failed: 2, loadedBytes: 0, totalBytes: 0 };
        const text = progressText(p, t);
        expect(text).toBe(expected);
    });
});
