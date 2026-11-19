/** 把解析器抛出的内部异常归类为面向用户的错误种类；文案在 SFC 的 <i18n> 中按 kind 取。 */
export type ParseErrorKind = 'notBlueprint' | 'checksum' | 'truncated' | 'newer' | 'unknown'
    // 从 dsp2b 取蓝图失败（非解析异常，由 App 直接设置）
    | 'dsp2bNotFound' | 'dsp2bUnreachable';

export interface ParseErrorInfo {
    kind: ParseErrorKind;
    /** 文案插值参数（newer: 蓝图版本与支持版本） */
    params: Record<string, string>;
}

const START = 'BLUEPRINT:';

/** 读取蓝图头部里的游戏版本，读不到返回 null */
export function headerGameVersion(code: string): string | null {
    if (!code.startsWith(START))
        return null;
    const end = code.indexOf('"', START.length);
    if (end < 0)
        return null;
    return code.substring(START.length, end).split(',')[9] || null;
}

function numericParts(v: string): number[] | null {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 按 主.次.修订 比较（忽略构建号），version 比 supported 新才为 true */
export function isNewerVersion(version: string, supported: string): boolean {
    const a = numericParts(version), b = numericParts(supported);
    if (!a || !b)
        return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i])
            return a[i] > b[i];
    }
    return false;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export function mapParseError(e: unknown, code: string, supported: string): ParseErrorInfo {
    const msg = messageOf(e);
    const none = {};
    if (msg === 'Invalid start')
        return { kind: 'notBlueprint', params: none };
    if (msg === 'Checksum not found' || msg === 'Checksum mismatch')
        return { kind: 'checksum', params: none };

    const version = headerGameVersion(code);
    if (version && isNewerVersion(version, supported))
        return { kind: 'newer', params: { version, supported } };

    const truncated = msg === 'Header too short'
        || e instanceof RangeError
        // pako 对截断的 gzip 返回 undefined，随后 .buffer 抛 TypeError
        || e instanceof TypeError
        || msg.startsWith('参数解析错误')
        // pako 抛出的是字符串形式的 zlib 错误；atob 对坏 base64 抛 InvalidCharacterError
        || (typeof e === 'string')
        || (e as { name?: string } | null)?.name === 'InvalidCharacterError';
    return { kind: truncated ? 'truncated' : 'unknown', params: none };
}
