import { IUniform, Material, Texture, Vector2 } from 'three';
import { IconTexture } from '@/iconTexture';

/** 图集的格数（IconTexture 的宽 × 高），各材质共用一份 */
export const ICON_GRID = new Vector2(IconTexture.WIDTH, IconTexture.HEIGHT);

export interface IconAtlasPatch {
    /** IconTexture 的图集贴图 */
    atlas: Texture | null;
    /** 额外的 uniform：名字 → 值（GLSL 声明写在 declarations 里） */
    uniforms?: Record<string, unknown>;
    /** 片元着色器里额外的声明（uniform 等） */
    declarations?: string;
    /**
     * 替换 #include <map_fragment> 的代码。可用：vIconUv（几何 uv）、
     * atlasIcon(uv)（本实例图标在 uv 处的颜色，uv 为 0..1）。
     */
    fragment: string;
    cacheKey: string;
}

/**
 * 让内置材质按实例属性 cargoIcon（IconTexture.requestIcon 的图集下标）从图标图集取色：
 * 货物板顶面与分拣器抓手上的物品贴花共用这一份着色器补丁。
 */
export function patchIconAtlas(m: Material, p: IconAtlasPatch) {
    m.onBeforeCompile = shader => {
        shader.uniforms.uIcons = { value: p.atlas };
        shader.uniforms.uIconGrid = { value: ICON_GRID };
        for (const [name, value] of Object.entries(p.uniforms ?? {}))
            shader.uniforms[name] = { value } as IUniform;
        shader.vertexShader = 'attribute float cargoIcon;\nuniform vec2 uIconGrid;\nvarying vec2 vIconUv;\nvarying vec2 vIconCell;\n'
            + shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
	vIconUv = uv;
	float iconId = floor(cargoIcon + 0.5);
	vIconCell = vec2(mod(iconId, uIconGrid.x), floor(iconId / uIconGrid.x));`);
        shader.fragmentShader = `uniform sampler2D uIcons;
uniform vec2 uIconGrid;
varying vec2 vIconUv;
varying vec2 vIconCell;
${p.declarations ?? ''}
vec4 atlasIcon(vec2 uv) { return texture2D(uIcons, (uv + vIconCell) / uIconGrid); }
` + shader.fragmentShader.replace('#include <map_fragment>', p.fragment);
    };
    m.customProgramCacheKey = () => p.cacheKey;
}
