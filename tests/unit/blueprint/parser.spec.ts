import { readFileSync } from "fs";
import { join } from "path";
import pako from "pako";
import { fromStr, toStr, MarkerParameters, StationParameters, parseMarkerContent, joinMarkerContent } from "@/blueprint/parser";
import { digest } from "@/blueprint/md5";

function payload(str: string) {
    const b64 = str.substring(str.indexOf('"') + 1, str.length - 33);
    return pako.ungzip(Buffer.from(b64, 'base64'));
}

/** 按游戏 BlueprintData.Export 的布局手工封装二进制，独立于编辑器的编码器 */
function wrap(body: number[]) {
    const head = 'BLUEPRINT:0,10,0,0,0,0,0,0,638783526515281167,0.10.32.25712,t,"';
    const s = head + Buffer.from(pako.gzip(Uint8Array.from(body))).toString('base64');
    const d = Buffer.from(digest(Uint8Array.from(Buffer.from(s, 'latin1')).buffer)).toString('hex').toUpperCase();
    return s + '"' + d;
}

class Bytes {
    data: number[] = [];
    private put(n: number, f: (v: DataView) => void) {
        const v = new DataView(new ArrayBuffer(n)); f(v);
        this.data.push(...new Uint8Array(v.buffer));
        return this;
    }
    i8(x: number) { return this.put(1, v => v.setInt8(0, x)); }
    u8(x: number) { return this.put(1, v => v.setUint8(0, x)); }
    i16(x: number) { return this.put(2, v => v.setInt16(0, x, true)); }
    i32(x: number) { return this.put(4, v => v.setInt32(0, x, true)); }
    f32(...xs: number[]) { xs.forEach(x => this.put(4, v => v.setFloat32(0, x, true))); return this; }
}

function fixture(name: string) {
    return readFileSync(join(__dirname, 'fixtures', name), 'utf8').trim();
}

describe('blueprint parser', () => {
    test('round trip', () => {
        const bp = fromStr('BLUEPRINT:0,10,401,0,0,0,0,0,637818182165693716,0.9.24.11286,test,test%20desc"H4sIAAAAAAAAC+2aP0wUQRTG3+4dt+uBt5ioySUml0hxIdHmlgDhiDvsFhYSCy0MoYBEhRYsLfxXa+IVFhbiNVrYGMMFEAuprKXCxBAawIAxFAiCiYz7dmeWF24bG2neL3mzX2bve29mdu+aewYAtISRgZjWMHJKGyAB6mo6B+1qGpZf3Zv9Iz1hLBRnqNb3V60ySEXBcQrxbFbfDvOS67qUwoUHHiagWn/4uX0hSQYEE4dvB1K8KZd6Hrpr75+dPT0wvPFifnLs4ofHfQ1/6fW0/9XqjHaGtfMy3hDWNfSOf8rSQDQ1MTZLta5yYF86Uj2TbCCrl69NVL+rNnyMRauDJtBbj848Osgrc4PCqHzvpXpdugEGmpGj5pw2L9x4JGrF0SrVO6FxR5lblNkgZkubs1BPzFrvh8Z9Zc6lmG0cataUGO+667k35/qp/nyqEmCguTXFfEJXXrrsJnvWWoZVparcpl8Q89Ccx+GTvC+2wjCeFnuo3v5ypxuj166kvSz2ZiZeBkZ7GRiG+Y/o7x5zPAjfASjlf8O5q4XoOVy3oueBP6q3jndpDMMwDMMwDMMwDMMwDMMwDMMwDPPPYDcCrMqXAq/YnkH1rxkzwMDOg5PQ3LYQdSNgq8J2fderDY1Uqd6TbrCn2hbS+jwwIazJj0k1qq9Bw8dAs9NU2YRN1ZUTddA8OT8lxs0f3u3uM/1Uv+3rCjAwCbZn4H96ht2cxIlXskJWcqjn5bSPgUmyKWfwF3VXFSMnJAAA"A7DF4C8BFFFC74EA6F1C5C2F8CA778BB')
        expect(fromStr(toStr(bp))).toEqual(bp);
    })

    // 0.10.32 起建筑记录版本标记为 -101（按建筑类型变长）
    test('0.10.32 blueprint (building version -101)', () => {
        const bp = fromStr(fixture('v0.10.32.txt'));
        expect(bp.header.gameVersion).toBe('0.10.32.25712');
        expect(bp.buildings).toHaveLength(4);
        for (const b of bp.buildings)
            expect(b.itemId).toBeGreaterThan(1000);
        expect(fromStr(toStr(bp))).toEqual(bp);
    })

    // 0.10.34 起头部为 BLUEPRINT:1（多 author/customVersion/externalFields），
    // 建筑标记 -102，二进制尾部追加 patch + 地基数据
    test('0.10.35 blueprint (BLUEPRINT:1, building version -102)', () => {
        const bp = fromStr(fixture('v0.10.35.txt'));
        expect(bp.header.gameVersion).toBe('0.10.35.29151');
        expect(bp.header.shortDesc).toBe('新蓝图');
        expect(bp.buildings).toHaveLength(20);
        for (const b of bp.buildings)
            expect(b.itemId).toBeGreaterThan(1000);
        const str = toStr(bp);
        expect(str.startsWith('BLUEPRINT:1,')).toBe(true);
        expect(fromStr(str)).toEqual(bp);
    })

    test('0.10.35 blueprint re-export is byte-identical to game output', () => {
        const original = fixture('v0.10.35.txt');
        const bp = fromStr(original);
        expect(Buffer.from(payload(toStr(bp)))).toEqual(Buffer.from(payload(original)));
    })

    // BlueprintBuilding.Import 的 -101 分拣器分支：两端各自的位置/yaw/tilt/pitch
    test('-101 inserter decodes both endpoints', () => {
        const w = new Bytes()
            .i32(1).i32(0).i32(0).i32(0).i32(1).i32(1).i32(0) // Version 1 + meta
            .u8(1).i8(0).i8(-1).i16(0).i16(200).i16(0).i16(0).i16(10).i16(10) // 1 area
            .i32(1) // 1 building
            .i32(-101).i32(0).i16(2011).i16(41).i8(0)
            .f32(1.5, 2.5, 0.25, 90) // localOffset, yaw
            .f32(0.5, 0.75) // tilt, pitch
            .f32(3.5, 4.5, 1.25, 180, 0.125, 0.0625) // localOffset2, yaw2, tilt2, pitch2
            .i32(-1).i32(-1).i8(1).i8(2).i8(3).i8(4).i8(5).i8(6).i16(0).i16(1101)
            .i16(1).i32(3); // parameters: [3]
        const bp = fromStr(wrap(w.data));
        const b = bp.buildings[0];
        expect(b.itemId).toBe(2011);
        expect(b.modelIndex).toBe(41);
        expect(b.localOffset).toEqual([{ x: 1.5, y: 2.5, z: 0.25 }, { x: 3.5, y: 4.5, z: 1.25 }]);
        expect(b.yaw).toEqual([90, 180]);
        expect(b.tilt).toEqual([0.5, 0.125]);
        expect(b.pitch).toEqual([0.75, 0.0625]);
        expect([b.outputToSlot, b.inputFromSlot, b.outputFromSlot, b.inputToSlot, b.outputOffset, b.inputOffset]).toEqual([1, 2, 3, 4, 5, 6]);
        expect(b.filterId).toBe(1101);
        expect(fromStr(toStr(bp))).toEqual(bp);
    })

    test('building content string round trip', () => {
        const bp = fromStr(fixture('v0.10.35.txt'));
        bp.buildings[0].content = '标记 note';
        expect(fromStr(toStr(bp)).buildings[0].content).toBe('标记 note');
    })

    /** 一栋 -102 建筑（无连接），参数为 params 的 int32 序列，附带 content */
    function singleBuilding(itemId: number, modelIndex: number, params: number[], content?: string) {
        const w = new Bytes()
            .i32(1).i32(0).i32(0).i32(0).i32(1).i32(1).i32(0) // Version 1 + meta
            .u8(1).i8(0).i8(-1).i16(0).i16(200).i16(0).i16(0).i16(10).i16(10) // 1 area
            .i32(1) // 1 building
            .i32(-102).i32(0).i16(itemId).i16(modelIndex).i8(0)
            .f32(1.5, 2.5, 0.25, 90)
            .i32(-1).i32(-1).i8(0).i8(0).i8(0).i8(0).i8(0).i8(0).i16(0).i16(0)
            .i16(params.length);
        params.forEach(x => w.i32(x));
        if (content === undefined) {
            w.i32(0);
        } else {
            const utf8 = Array.from(Buffer.from(content, 'utf8'));
            w.i32(content.length).u8(utf8.length);
            w.data.push(...utf8); // 长度 < 128，单字节前缀
        }
        return wrap(w.data);
    }

    // ContentEscape：\ -> \\，换行 -> \n；四段以换行分隔（word/tags/name/comment）
    test('marker content split and escape', () => {
        const parts = { word: 'a\nb', tags: 't', name: 'n\\x', comment: 'l1\nl2' };
        const content = 'a\\nb\nt\nn\\\\x\nl1\\nl2';
        expect(joinMarkerContent(parts)).toBe(content);
        expect(parseMarkerContent(content)).toEqual(parts);
        expect(parseMarkerContent('only')).toEqual({ word: 'only', tags: '', name: '', comment: '' });
    })

    // BuildingParameters 的 Marker 分支：[0..7] 字段，[47] 注释长度，[48..] contentColorIndex
    test('laser beacon (2401) marker params and content round trip', () => {
        const params = new Array<number>(2048).fill(0);
        params.splice(0, 8, 83, 1250, 150, 2, 2, 1001, 7, 5);
        params[47] = 3;
        params.splice(48, 3, 11, 22, 33);
        params[1000] = 99; // 未知槽位也要保留
        const content = 'a\\nb\nt\nn\nl1\\nl2';
        const str = singleBuilding(2401, 664, params, content);
        const bp = fromStr(str);
        const b = bp.buildings[0];
        expect(b.parameters as MarkerParameters).toMatchObject({
            color: 83, height: 12.5, radius: 1.5, visibility: 2, detailLevel: 2,
            icon: 1001, digitalSignalId: 7, dfAttractionFlags: 5,
            contentColorIndex: [11, 22, 33],
        });
        expect(b.content).toBe(content);
        expect(Buffer.from(payload(toStr(bp)))).toEqual(Buffer.from(payload(str)));
        // 编辑字段后导出，再解析应得到新值
        (b.parameters as MarkerParameters).height = 20;
        expect((fromStr(toStr(bp)).buildings[0].parameters as MarkerParameters).height).toBe(20);
    })

    // 轨道采集器：全 0 参数块不能经由 station 编码器写成 ±1
    test('orbital collector (2105) all-zero parameters export byte-identical', () => {
        const str = singleBuilding(2105, 117, new Array<number>(2048).fill(0));
        const bp = fromStr(str);
        expect(bp.buildings[0].parameters).not.toBeNull();
        expect(Buffer.from(payload(toStr(bp)))).toEqual(Buffer.from(payload(str)));
    })

    test('orbital collector (2105) non-zero parameters use the station layout', () => {
        const params = new Array<number>(2048).fill(0);
        params[0] = 1001; // storage[0].itemId
        params[320 + 8] = 4; // pilerCount
        const str = singleBuilding(2105, 117, params);
        const bp = fromStr(str);
        const p = bp.buildings[0].parameters as StationParameters;
        expect(p.storage[0].itemId).toBe(1001);
        expect(p.pilerCount).toBe(4);
        expect(fromStr(toStr(bp))).toEqual(bp);
    })
});
