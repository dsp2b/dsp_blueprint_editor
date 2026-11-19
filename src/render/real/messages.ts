/**
 * 真实模型下载进度提示的文案；运行时合并进全局 vue-i18n（见 index.ts）。
 * 生产构建的 vue-i18n 是 runtimeOnly（不含消息编译器），运行时合并的字符串模板不会被编译，t 只返回键名（如 modelPill.loading），
 * 所以这里直接写成预编译的消息函数（等价于 `{name}` 命名插值与 `a | b` 复数）。
 */
import type { MessageContext } from 'vue-i18n';

type Message = (ctx: MessageContext) => string;

const progress = (pre: string, mid: string, post: string): Message => ctx => {
    const n = ctx.named;
    return `${pre}${n('done')}/${n('total')}${mid}${n('loaded')} / ${n('size')}${post}`;
};

export const modelPillMessages: Record<'zh' | 'en', { modelPill: Record<string, Message> }> = {
    zh: {
        modelPill: {
            loading: progress('正在下载建筑模型 ', '（', ' MB）'),
            loadingFailed: ctx => `${progress('正在下载建筑模型 ', '（', ' MB）')(ctx)}，${ctx.named('failed')} 种失败`,
            failed: ctx => `${ctx.named('failed')} 种建筑模型下载失败，仍显示为方盒`,
            retry: () => '重试',
        },
    },
    en: {
        modelPill: {
            loading: progress('Downloading building models ', ' (', ' MB)'),
            loadingFailed: ctx => `${progress('Downloading building models ', ' (', ' MB)')(ctx)}, ${ctx.named('failed')} failed`,
            failed: ctx => ctx.plural([
                `${ctx.named('failed')} building model failed to download and stays a box`,
                `${ctx.named('failed')} building models failed to download and stay boxes`,
            ]) as string,
            retry: () => 'Retry',
        },
    },
};
