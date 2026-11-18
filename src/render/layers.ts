import { Camera, Group, Matrix4, WebGLRenderer } from 'three';
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
    /** 渲染用的相机；update 时已是这一帧的位姿 */
    camera: Camera;
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
    /** dt：距上一帧的秒数；渲染器在相机更新之后、渲染之前调用 */
    update(dt: number): void;
    dispose(): void;
    setVisible(visible: boolean): void;
    /** 编辑命令执行/撤销/重做之后（配方、过滤物品、槽位等可能变了），图标更新事件已分发完 */
    dataChanged?(): void;
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
 * 当前模式下各图层是否显示：选真实模型且注册了真实模型图层时显示真实模型图层，否则显示精简图层。
 * 真实模型图层自己在模型到达前用精简外观占位，所以不需要等它就绪。
 */
export function layerVisibility(instances: readonly LayerInstance[], mode: DisplayMode): boolean[] {
    const real = mode === 'model' && instances.some(i => i.entry.mode === 'model');
    return instances.map(i => i.entry.mode === 'model' ? real : !real);
}
