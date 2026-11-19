import { apiUrl, backLink, fetchDsp2bBlueprint, isPlausibleId } from '@/open/dsp2bSource';

const json = (status: number, body: unknown) => async () => ({
    status, ok: status >= 200 && status < 300, json: async () => body,
}) as unknown as Response;

describe('isPlausibleId', () => {
    it('accepts letters, digits and dashes up to 64 chars', () => {
        expect(isPlausibleId('abc-DEF-123')).toBe(true);
        expect(isPlausibleId('a'.repeat(64))).toBe(true);
    });
    it('rejects empty, too long, null and other characters', () => {
        expect(isPlausibleId('')).toBe(false);
        expect(isPlausibleId(null)).toBe(false);
        expect(isPlausibleId('a'.repeat(65))).toBe(false);
        expect(isPlausibleId('../x')).toBe(false);
        expect(isPlausibleId('a b')).toBe(false);
        expect(isPlausibleId('a_b')).toBe(false);
    });
});

describe('urls', () => {
    it('builds the api url', () => {
        expect(apiUrl('abc-1')).toBe('https://www.dsp2b.com/api/blueprint/abc-1');
    });
    it('builds the back link per language', () => {
        expect(backLink('abc-1', 'zh')).toBe('https://www.dsp2b.com/zh-CN/blueprint/abc-1');
        expect(backLink('abc-1', 'zh-CN')).toBe('https://www.dsp2b.com/zh-CN/blueprint/abc-1');
        expect(backLink('abc-1', 'en')).toBe('https://www.dsp2b.com/en/blueprint/abc-1');
        expect(backLink('abc-1', 'en-US')).toBe('https://www.dsp2b.com/en/blueprint/abc-1');
    });
});

describe('fetchDsp2bBlueprint', () => {
    it('returns ok with the code on 200', async () => {
        const r = await fetchDsp2bBlueprint('a', json(200, { id: 'a', title: 't', blueprint: 'BLUEPRINT:1' }));
        expect(r).toEqual({ kind: 'ok', code: 'BLUEPRINT:1' });
    });
    it('returns not_found on 404', async () => {
        expect(await fetchDsp2bBlueprint('a', json(404, { error: 'not_found' }))).toEqual({ kind: 'not_found' });
    });
    it('returns unreachable on 5xx, network error and malformed 200', async () => {
        expect(await fetchDsp2bBlueprint('a', json(500, { error: 'server_error' }))).toEqual({ kind: 'unreachable' });
        expect(await fetchDsp2bBlueprint('a', async () => { throw new TypeError('Failed to fetch'); })).toEqual({ kind: 'unreachable' });
        expect(await fetchDsp2bBlueprint('a', json(200, { id: 'a' }))).toEqual({ kind: 'unreachable' });
        expect(await fetchDsp2bBlueprint('a', json(200, { blueprint: '' }))).toEqual({ kind: 'unreachable' });
    });
    it('returns unreachable when the request times out', async () => {
        const hang = (_: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        });
        expect(await fetchDsp2bBlueprint('a', hang, 20)).toEqual({ kind: 'unreachable' });
    });
});
