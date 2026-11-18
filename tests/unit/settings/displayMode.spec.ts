import { resolveDisplayMode } from "@/settings";

const auto = { defaultMode: 'auto' as const, viewMode: null };

describe('resolveDisplayMode', () => {
    it('Auto uses Real model on a normal connection', () => {
        expect(resolveDisplayMode({ effectiveType: '4g', saveData: false }, auto)).toBe('model');
    });

    it('Auto uses Real model when the browser reports no connection info', () => {
        expect(resolveDisplayMode(undefined, auto)).toBe('model');
        expect(resolveDisplayMode(null, auto)).toBe('model');
        expect(resolveDisplayMode({}, auto)).toBe('model');
    });

    it('Auto uses Simple when data saver is on', () => {
        expect(resolveDisplayMode({ effectiveType: '4g', saveData: true }, auto)).toBe('box');
    });

    it.each(['slow-2g', '2g', '3g'])('Auto uses Simple on %s', effectiveType => {
        expect(resolveDisplayMode({ effectiveType }, auto)).toBe('box');
    });

    it('a remembered manual choice wins over the network under Auto', () => {
        expect(resolveDisplayMode({ effectiveType: '2g' }, { defaultMode: 'auto', viewMode: 'model' })).toBe('model');
        expect(resolveDisplayMode({ effectiveType: '4g' }, { defaultMode: 'auto', viewMode: 'box' })).toBe('box');
    });

    it('an explicit default wins over the network and the remembered choice', () => {
        expect(resolveDisplayMode({ effectiveType: '4g' }, { defaultMode: 'box', viewMode: 'model' })).toBe('box');
        expect(resolveDisplayMode({ saveData: true }, { defaultMode: 'model', viewMode: 'box' })).toBe('model');
        expect(resolveDisplayMode({ effectiveType: '2g' }, { defaultMode: 'model', viewMode: null })).toBe('model');
    });
});
