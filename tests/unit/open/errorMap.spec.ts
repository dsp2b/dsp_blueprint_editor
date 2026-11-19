import { readFileSync } from "fs";
import { join } from "path";
import { fromStr } from "@/blueprint/parser";
import { digest } from "@/blueprint/md5";
import { mapParseError, isNewerVersion } from "@/open/errorMap";

const fixture = readFileSync(join(__dirname, '../blueprint/fixtures/v0.10.35.txt'), 'utf8').trim();
const caught = (s: string) => { try { fromStr(s); } catch (e) { return e; } throw new Error('did not throw'); };
const SUPPORTED = '0.10.35';

describe('mapParseError', () => {
    it('maps a non-blueprint string', () => {
        expect(mapParseError(caught('hello'), 'hello', SUPPORTED).kind).toBe('notBlueprint');
    });
    it('maps checksum mismatch and checksum missing to one "incomplete code" kind', () => {
        const tampered = fixture.replace('H4sI', 'H4sJ');
        expect(mapParseError(caught(tampered), tampered, SUPPORTED).kind).toBe('checksum');
        const noSum = fixture + 'x';
        expect(mapParseError(caught(noSum), noSum, SUPPORTED).kind).toBe('checksum');
    });
    it('maps short header, DataView RangeError and pako errors to truncated', () => {
        expect(mapParseError(Error('Header too short'), 'BLUEPRINT:1,2', SUPPORTED).kind).toBe('truncated');
        expect(mapParseError(new RangeError('Invalid DataView length 4'), fixture, SUPPORTED).kind).toBe('truncated');
        expect(mapParseError('incorrect header check', fixture, SUPPORTED).kind).toBe('truncated');
        expect(mapParseError(Error('参数解析错误：数据段太短'), fixture, SUPPORTED).kind).toBe('truncated');
    });
    const withChecksum = (body: string) => body + '"' + Buffer.from(digest(Uint8Array.from(Buffer.from(body, 'latin1')).buffer)).toString('hex').toUpperCase();
    it('maps a truncated gzip payload with a valid checksum to truncated', () => {
        const q = fixture.indexOf('"');
        const code = withChecksum(fixture.substring(0, q + 1) + fixture.substring(q + 1, q + 41));
        expect(mapParseError(caught(code), code, SUPPORTED).kind).toBe('truncated');
    });
    it('maps a corrupt gzip payload with a valid checksum to truncated', () => {
        const q = fixture.indexOf('"');
        const gz = Buffer.from(fixture.substring(q + 1, fixture.lastIndexOf('"')), 'base64');
        gz[gz.length >> 1] ^= 0xff;
        gz[gz.length - 8] ^= 0xff; // 同时破坏 CRC32，确保 pako 报错
        const code = withChecksum(fixture.substring(0, q + 1) + gz.toString('base64'));
        expect(mapParseError(caught(code), code, SUPPORTED).kind).toBe('truncated');
    });
    it('maps to newer-than-supported when the header version is newer, carrying both versions', () => {
        const code = fixture.replace('0.10.35.29151', '0.11.0.30000');
        const m = mapParseError(new RangeError('Invalid DataView length'), code, SUPPORTED);
        expect(m.kind).toBe('newer');
        expect(m.params).toEqual({ version: '0.11.0.30000', supported: SUPPORTED });
    });
    it('does not blame the version for a same-or-older blueprint, nor for an incomplete code', () => {
        expect(mapParseError(new RangeError('x'), fixture, SUPPORTED).kind).toBe('truncated');
        const tampered = fixture.replace('0.10.35.29151', '0.11.0.1').replace('H4sI', 'H4sJ');
        expect(mapParseError(caught(tampered), tampered, SUPPORTED).kind).toBe('checksum');
    });
    it('falls back to unknown, never exposing the raw exception text as the message key', () => {
        const m = mapParseError(Error('boom'), fixture, SUPPORTED);
        expect(m.kind).toBe('unknown');
    });
});

describe('isNewerVersion', () => {
    it('compares major.minor.patch and ignores the build number', () => {
        expect(isNewerVersion('0.10.35.29151', '0.10.35')).toBe(false);
        expect(isNewerVersion('0.10.36.1', '0.10.35')).toBe(true);
        expect(isNewerVersion('0.11.0', '0.10.35')).toBe(true);
        expect(isNewerVersion('1.0.0', '0.10.35')).toBe(true);
        expect(isNewerVersion('0.10.9', '0.10.35')).toBe(false);
        expect(isNewerVersion('garbage', '0.10.35')).toBe(false);
    });
});
