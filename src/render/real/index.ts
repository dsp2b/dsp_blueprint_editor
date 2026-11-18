import type { Layer, LayerContext } from '../layers';

/**
 * 真实模型图层（占位）。在真实模型实现之前 ready 恒为 false，
 * 因此选"真实模型"时渲染器仍显示精简图层。
 */
export function createRealLayer(): Layer {
    let root: LayerContext['root'] | null = null;
    return {
        ready: false,
        build(ctx) {
            root = ctx.root;
        },
        update() {
            // 尚无内容
        },
        dispose() {
            root = null;
        },
        setVisible(visible) {
            if (root)
                root.visible = visible;
        },
    };
}
