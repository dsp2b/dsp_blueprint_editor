import { Color, Material, Matrix4 } from 'three';

/** 高亮时不匹配的实体（方盒、建筑模型、分拣器）的不透明度 */
export const GHOST_OPACITY = 0.14;
/** 高亮时不匹配的薄面（传送带条带、货物板、分拣器弧线）的不透明度：太淡会看不出走向 */
export const DIM_OPACITY = 0.3;

/** 实例颜色与材质颜色相乘：悬停、选中时偏全息青并提亮 */
export const WHITE = new Color(1, 1, 1);
export const HOVER_TINT = new Color(1.3, 1.55, 1.75);
export const SELECT_TINT = new Color(1.45, 1.85, 2.3);

/** 选中优先于悬停；都不是时为 null */
export function tintFor(index: number, hovered: number | null, selected: ReadonlySet<number>): Color | null {
    if (selected.has(index))
        return SELECT_TINT;
    if (index === hovered)
        return HOVER_TINT;
    return null;
}

/** 高亮时的淡化材质：原材质的克隆，透明、不写深度，不透明度按 opacity 缩放 */
export function fadedMaterial<M extends Material>(m: M, opacity: number): M {
    const d = m.clone() as M;
    d.transparent = true;
    d.opacity = m.opacity * opacity;
    d.depthWrite = false;
    return d;
}

/**
 * glTF 模型空间 → 建筑本地空间：本地 (x, y, z) = glTF (−x, z, y)
 * （等价于 rotation.set(π/2, 0, π, 'ZYX')）。建筑本地 z 朝上、y 朝正前方，
 * 与 unitBoxTrans 对游戏模型空间的映射一致，因此不会镜像。
 */
export const GLTF_TO_LOCAL = new Matrix4().set(
    -1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);
