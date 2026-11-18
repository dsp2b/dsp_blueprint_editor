import { Group, Matrix4, WebGLRenderer } from 'three';
import { BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import { DisplayMode } from '@/settings';
import { IconGeometry } from '@/icons';
import { IconTexture } from '@/iconTexture';
import { createBoxesLayer } from './simple/boxes';
import { createLinksLayer } from './simple/links';
import { createRealLayer } from './real';

/** 渲染器在同一时刻共享给所有图层的显示状态（工具栏开关、减少动态效果） */
export interface ViewState {
    /** 传送带流向动画（设置 flow，且未要求减少动态效果） */
    flow: boolean;
    /** 配方/建筑图标标记 */
    badges: boolean;
    reducedMotion: boolean;
}

export interface LayerContext {
    /** 图层自己的根节点，渲染器把它加进场景；setVisible 默认切换它 */
    root: Group;
    renderer: WebGLRenderer;
    /** 星球半径 */
    R: number;
    data: BlueprintData;
    buildings: BlueprintBuilding[];
    /** 每个建筑（按 index）两端的世界变换，见 calcBuildingTrans */
    transforms: Matrix4[][];
    /** 共享的图标（精简模式放在方盒顶面，传送带/分拣器为悬浮图标） */
    icons: IconGeometry;
    iconTexture: IconTexture;
    view: Readonly<ViewState>;
}

/**
 * 图层契约。渲染器为每个打开的蓝图从注册表创建一组图层，build 一次，每帧 update，
 * 关闭或换蓝图时 dispose。高亮/悬停/选中通过可选钩子分发给所有图层。
 */
export interface Layer {
    build(ctx: LayerContext): void;
    /** dt：距上一帧的秒数 */
    update(dt: number): void;
    dispose(): void;
    setVisible(visible: boolean): void;
    /** 真实模型图层：已能替代精简图层时为 true；精简图层不需要 */
    readonly ready?: boolean;
    /** mask[index] 为 1 的建筑正常显示，其余淡化；null 表示取消高亮 */
    setHighlight?(mask: Uint8Array | null): void;
    setHover?(index: number | null): void;
    setSelected?(indices: ReadonlySet<number>): void;
    /** 建筑主体的模型矩阵（SpitterInfo 用来把槽位投影到屏幕） */
    modelOf?(index: number): Matrix4 | null;
}

export interface LayerEntry {
    id: string;
    /** 'box' 为精简模式图层，'model' 为真实模型图层 */
    mode: DisplayMode;
    create(): Layer;
}

/** 注册表：后续任务只填充各模块，不再改渲染器里的图层接线 */
export const layerRegistry: readonly LayerEntry[] = [
    { id: 'simple-boxes', mode: 'box', create: createBoxesLayer },
    { id: 'simple-links', mode: 'box', create: createLinksLayer },
    { id: 'real', mode: 'model', create: createRealLayer },
];

export interface LayerInstance {
    entry: LayerEntry;
    layer: Layer;
}

/**
 * 当前模式下各图层是否显示：选真实模型且有真实模型图层就绪时显示真实模型图层，
 * 否则显示精简图层（没有可用的真实模型时两种模式都显示精简）。
 */
export function layerVisibility(instances: readonly LayerInstance[], mode: DisplayMode): boolean[] {
    const realReady = mode === 'model' && instances.some(i => i.entry.mode === 'model' && i.layer.ready);
    return instances.map(i => i.entry.mode === 'model' ? realReady : !realReady);
}
