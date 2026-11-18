import { readFileSync } from "fs";
import { join } from "path";
import { fromStr } from "@/blueprint/parser";

const fixture = readFileSync(join(__dirname, '../blueprint/fixtures/v0.10.35.txt'), 'utf8').trim();

describe('fromStr onProgress', () => {
    it('reports buildings read / total, ending at total, without changing the result', () => {
        const calls: Array<[number, number]> = [];
        const withCb = fromStr(fixture, { onProgress: (d, t) => calls.push([d, t]) });
        const total = withCb.buildings.length;
        expect(total).toBeGreaterThan(0);
        expect(calls[calls.length - 1]).toEqual([total, total]);
        expect(calls.every(([d, t]) => t === total && d <= t)).toBe(true);
        expect(calls.map(c => c[0])).toEqual([...calls.map(c => c[0])].sort((a, b) => a - b));
        expect(withCb).toEqual(fromStr(fixture));
    });
});
