/** 从 dsp2b 站点按蓝图 id 取得蓝图代码（纯模块，fetch 可注入）。 */
export const DSP2B_BASE = 'https://www.dsp2b.com';
export const FETCH_TIMEOUT_MS = 15000;

export type Dsp2bOutcome =
    | { kind: 'ok'; code: string }
    | { kind: 'not_found' }
    | { kind: 'unreachable' };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** dsp2b 的 id 字符集：字母、数字、'-'，最长 64 */
export function isPlausibleId(id: string | null | undefined): id is string {
    return !!id && id.length <= 64 && /^[A-Za-z0-9-]+$/.test(id);
}

/** 不在 /api 下：dsp2b 生产 ingress 把 /api 整个转给 Go 后端 */
export const apiUrl = (id: string) => `${DSP2B_BASE}/open-api/blueprint/${id}`;

/** 回到 dsp2b 蓝图页的链接；界面语言为中文时用 zh-CN，否则 en */
export const backLink = (id: string, locale: string) =>
    `${DSP2B_BASE}/${locale.startsWith('zh') ? 'zh-CN' : 'en'}/blueprint/${id}`;

export async function fetchDsp2bBlueprint(
    id: string, fetchImpl: FetchLike, timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Dsp2bOutcome> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetchImpl(apiUrl(id), { signal: ac.signal });
        if (res.status === 404)
            return { kind: 'not_found' };
        if (!res.ok)
            return { kind: 'unreachable' };
        const body = await res.json();
        if (typeof body?.blueprint !== 'string' || !body.blueprint.trim())
            return { kind: 'unreachable' };
        return { kind: 'ok', code: body.blueprint };
    } catch {
        return { kind: 'unreachable' };
    } finally {
        clearTimeout(timer);
    }
}
