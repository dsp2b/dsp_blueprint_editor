import { pastedText } from '@/open/paste';

const target = (editable: boolean) => ({ closest: (sel: string) => (editable && sel.includes('textarea') ? {} : null) });
const ev = (text: string, editable = false) => ({
    target: target(editable),
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
});

describe('pastedText (paste while a blueprint is open replaces it)', () => {
    it('returns the pasted text when pasting onto the page', () => {
        expect(pastedText(ev('BLUEPRINT:0,10,...'))).toBe('BLUEPRINT:0,10,...');
    });
    it('leaves pastes into editable fields alone', () => {
        expect(pastedText(ev('BLUEPRINT:0,10,...', true))).toBeNull();
    });
    it('ignores empty pastes', () => {
        expect(pastedText(ev('  \n'))).toBeNull();
        expect(pastedText({ target: null, clipboardData: null })).toBeNull();
    });
});
