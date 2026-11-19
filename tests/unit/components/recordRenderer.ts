import { App, Component, createRenderer, h } from 'vue';
import { createI18n } from 'vue-i18n';

/** 无 DOM 的渲染器：记录元素与属性，用来检查组件真实传给 DOM 的属性值 */
export interface RNode { tag: string; props: Record<string, unknown>; children: RNode[]; text: string; parent: RNode | null }

const node = (tag: string): RNode => ({ tag, props: {}, children: [], text: '', parent: null });

const { createApp } = createRenderer<RNode, RNode>({
    createElement: tag => node(tag),
    createText: text => ({ ...node('#text'), text }),
    createComment: text => ({ ...node('#comment'), text }),
    setText: (n, text) => { n.text = text; },
    setElementText: (n, text) => { n.children = []; n.text = text; },
    insert: (child, parent, anchor) => {
        child.parent = parent;
        const i = anchor ? parent.children.indexOf(anchor) : -1;
        if (i >= 0) parent.children.splice(i, 0, child); else parent.children.push(child);
    },
    remove: child => {
        const p = child.parent;
        if (p) p.children.splice(p.children.indexOf(child), 1);
        child.parent = null;
    },
    parentNode: n => n.parent,
    nextSibling: n => {
        const p = n.parent;
        return p ? p.children[p.children.indexOf(n) + 1] ?? null : null;
    },
    patchProp: (el, key, _prev, next) => { el.props[key] = next; },
});

export function mountRecorded(component: Component, props: Record<string, unknown>, setup?: (app: App<RNode>) => void) {
    const root = node('root');
    const app = createApp({ render: () => h(component, props) });
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
    setup?.(app);
    app.mount(root);
    return { root, unmount: () => app.unmount() };
}

export function findAll(n: RNode, tag: string): RNode[] {
    return [...(n.tag === tag ? [n] : []), ...n.children.flatMap(c => findAll(c, tag))];
}

export const flushPromises = () => new Promise(r => setTimeout(r, 0));
