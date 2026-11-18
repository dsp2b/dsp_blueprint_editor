import * as fs from 'fs';
import * as path from 'path';
import { items } from '@/data/itemsData';
import { itemsMap } from '@/data/items';
import { buildingMeta } from '@/data/building';

// Belt models have no static model: they are drawn procedurally (see tools/extract/coverage.py NO_STATIC_MODEL).
const noStaticModel = new Set([35, 36, 37]);

const manifestPath = path.join(__dirname, '../../../public/models/manifest.json');

describe('generated game data coverage', () => {
    test('every buildable item model has building metadata or is a belt', () => {
        const missing: string[] = [];
        let checked = 0;
        // buildIndex > 0 marks CanBuild items; vessels and fighters also carry a model index but are not buildable.
        for (const item of items.filter(i => (i.buildIndex ?? 0) > 0)) {
            for (const model of item.models) {
                checked++;
                if (!buildingMeta.has(model) && !noStaticModel.has(model)) {
                    missing.push(`${item.id} ${item.name} -> model ${model}`);
                }
            }
        }
        expect(checked).toBeGreaterThanOrEqual(60);
        expect(missing).toEqual([]);
    });

    test('items 2401 and 1211 exist', () => {
        expect(itemsMap.has(2401)).toBe(true);
        expect(itemsMap.has(1211)).toBe(true);
    });

    describe('models manifest', () => {
        type Entry = { file: string };
        type Manifest = { buildings: Record<string, Entry>; belts: Record<string, Entry>; sorters: Record<string, Entry> };
        const readManifest = (): Manifest => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        test('lists an existing GLB for every static building model with metadata', () => {
            const manifest = readManifest();
            const problems: string[] = [];
            for (const id of buildingMeta.keys()) {
                if (noStaticModel.has(id)) continue;
                const entry = manifest.buildings[String(id)];
                if (!entry) {
                    problems.push(`model ${id}: not in manifest`);
                } else if (!fs.existsSync(path.join(path.dirname(manifestPath), entry.file))) {
                    problems.push(`model ${id}: ${entry.file} missing on disk`);
                }
            }
            expect(problems).toEqual([]);
        });

        test('lists 3 belt tiers and 4 sorter tiers', () => {
            const manifest = readManifest();
            expect(Object.keys(manifest.belts).sort()).toEqual(['mk1', 'mk2', 'mk3']);
            const tiers = Object.keys(manifest.sorters).filter(k => !k.endsWith('-lod2')).sort();
            expect(tiers).toEqual(['sorter-mk1', 'sorter-mk2', 'sorter-mk3', 'sorter-mk4']);
            for (const e of [...Object.values(manifest.belts), ...Object.values(manifest.sorters)]) {
                expect(fs.existsSync(path.join(path.dirname(manifestPath), e.file))).toBe(true);
            }
        });
    });
});
