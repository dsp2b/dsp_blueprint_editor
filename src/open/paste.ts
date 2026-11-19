/** 可以输入文字的地方：在这里粘贴是普通的编辑，不当作打开蓝图（只读的蓝图代码框不算） */
const EDITABLE = 'input:not([readonly]), textarea:not([readonly]), select, [contenteditable]:not([contenteditable="false"])';

export interface PasteLike {
    target: EventTarget | { closest?: (selector: string) => unknown } | null;
    clipboardData: { getData(type: string): string } | null;
}

/** 已打开蓝图时在页面上（不在输入框里）粘贴的文本，用来替换当前蓝图；不该处理时返回 null */
export function pastedText(e: PasteLike): string | null {
    const target = e.target as { closest?: (selector: string) => unknown } | null;
    if (target?.closest?.(EDITABLE))
        return null;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    return text.trim() ? text : null;
}
