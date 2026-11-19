import { InstancedBufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, UniformsUtils, ShaderMaterial, Texture, UniformsLib, Color, ShaderLib, Vector2, Vector3, InstancedBufferGeometry, Mesh } from "three";
import { BlueprintBuilding } from "./blueprint/parser";
import { IconTexture } from "./iconTexture";

export class IconsMaterial extends ShaderMaterial {
    sizeAttenuation = true;

    get map() { return this.uniforms.map.value as Texture; }
    set map(m: Texture) { this.uniforms.map.value = m; }

    get color() { return this.uniforms.diffuse.value as Color; }
    set color(m: Color) { this.uniforms.diffuse.value = m; }

    get iMapSize() { return this.uniforms.iMapSize.value as Vector2; }
    set iMapSize(m: Vector2) { this.uniforms.iMapSize.value = m; }

    constructor(map: Texture) {
        super({
            uniforms: UniformsUtils.merge([
                UniformsLib.common,
                {
                    iMapSize: {
                        value: new Vector2(IconTexture.WIDTH, IconTexture.HEIGHT),
                    },
                },
            ]),
            vertexShader: `
attribute vec3 iconPos;
attribute vec2 iconScale;
// 非零时图标平铺在 iconAxisX/iconAxisY 张成的平面上（方盒顶面），否则为朝向屏幕的悬浮图标
attribute vec3 iconAxisX;
attribute vec3 iconAxisY;
attribute float iconDim;
varying float vDim;

attribute int iconId;
attribute vec2 offset;

uniform ivec2 iMapSize;

#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {
	#include <uv_vertex>
	ivec2 iPosition = ivec2(iconId % iMapSize.x, iconId / iMapSize.x);
	vMapUv = (vMapUv + vec2(iPosition)) / vec2(iMapSize);

	vDim = iconDim;
	if (dot(iconAxisX, iconAxisX) > 0.) {
		vec3 world = iconPos + iconAxisX * (position.x * iconScale.x) + iconAxisY * (position.y * iconScale.y);
		vec4 mvFlat = modelViewMatrix * vec4(world, 1.0);
		gl_Position = projectionMatrix * mvFlat;
		#include <logdepthbuf_vertex>
		#include <clipping_planes_vertex>
		vec4 mvPosition = mvFlat;
		#include <fog_vertex>
		return;
	}

	vec4 mvPosition = modelViewMatrix * vec4(iconPos, 1.0);

	vec2 scale = iconScale;
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif

	mvPosition.xy += position.xy * scale + offset;

	vec4 depthPosition = mvPosition;
	depthPosition.z += 5.;

	vec4 glDepthPosition = projectionMatrix * depthPosition;
	gl_Position = projectionMatrix * mvPosition;
	gl_Position /= gl_Position.w;
	gl_Position.z = glDepthPosition.z / glDepthPosition.w;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,
            fragmentShader: ShaderLib.sprite.fragmentShader
                .replace('#include <common>', 'varying float vDim;\n#include <common>')
                .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n\tdiffuseColor.a *= 1.0 - 0.85 * vDim;'),
        });
        this.map = map;
        this.depthTest = true;
        this.depthWrite = false;
        this.transparent = true;
        this.fog = true;
        this.defaultAttributeValues.iconScale = Float32Array.of(1.0, 1.0);
    }
}

const zero3 = new Vector3();

function updateAttr(attr: InstancedBufferAttribute, index: number) {
    const count = attr.itemSize;
    let start = index * count;
    let end = start + count;
    if (attr.updateRange.count === -1) {
        attr.needsUpdate = true;
    } else {
        start = Math.min(start, attr.updateRange.offset);
        end = Math.max(end, attr.updateRange.offset + attr.updateRange.count);
    }
    attr.updateRange.offset = start;
    attr.updateRange.count = end - start;
}

function extendAttr(attr: InstancedBufferAttribute, newLength: number) {
    const newArr = new (attr.array.constructor as Int32ArrayConstructor)(newLength * attr.itemSize);
    newArr.set(attr.array);
    attr.array = newArr;
}

export class IconGeometry extends InstancedBufferGeometry {
    constructor(length: number, hasScale=true) {
        super();
        this.instanceCount = 0;

        const float32Array = new Float32Array([
            - 0.5, - 0.5, 0, 0, 0,
            - 0.5,   0.5, 0, 0, 1,
              0.5, - 0.5, 0, 1, 0,
              0.5,   0.5, 0, 1, 1,
        ]);

        const interleavedBuffer = new InterleavedBuffer(float32Array, 5);

        this.setIndex([0, 2, 1,  1, 2, 3]);
        this.setAttribute('position', new InterleavedBufferAttribute(interleavedBuffer, 3, 0, false));
        this.setAttribute('uv',       new InterleavedBufferAttribute(interleavedBuffer, 2, 3, false));

        this.setAttribute('iconId', new InstancedBufferAttribute(new Int32Array(length), 1));
        this.setAttribute('iconPos', new InstancedBufferAttribute(new Float32Array(length * 3), 3));
        if (hasScale)  // TODO: workaround for iconSubscript
            this.setAttribute('iconScale', new InstancedBufferAttribute(new Float32Array(length * 2), 2));
        this.setAttribute('iconAxisX', new InstancedBufferAttribute(new Float32Array(length * 3), 3));
        this.setAttribute('iconAxisY', new InstancedBufferAttribute(new Float32Array(length * 3), 3));
        this.setAttribute('iconDim', new InstancedBufferAttribute(new Float32Array(length), 1));
    }

    private indexMap = new Map<BlueprintBuilding, number>();
    private nextIndex = 0;
    /** 当前的淡化规则（setDim），之后新加的图标也按它淡化 */
    private dim: ((b: BlueprintBuilding) => boolean) | null = null;

    reserve(length: number) {
        this.dispose();
		extendAttr(this.getAttribute('iconId') as InstancedBufferAttribute, length);
		extendAttr(this.getAttribute('iconPos') as InstancedBufferAttribute, length);
		extendAttr(this.getAttribute('iconScale') as InstancedBufferAttribute, length);
		extendAttr(this.getAttribute('iconAxisX') as InstancedBufferAttribute, length);
		extendAttr(this.getAttribute('iconAxisY') as InstancedBufferAttribute, length);
		extendAttr(this.getAttribute('iconDim') as InstancedBufferAttribute, length);
    }

    hasIcon(b: BlueprintBuilding) {
        return this.indexMap.has(b);
    }

    /** axes 给出时图标平铺在该平面上（x、y 为单位方向），否则朝向屏幕 */
    addIcon(b: BlueprintBuilding, iconId: number, pos: Vector3, scale: Vector2, update=false, axes?: { x: Vector3, y: Vector3 }) {
        const index = this.nextIndex++;
        if (index >= this.getAttribute('iconId').count) {
            this.reserve(Math.ceil(index * 1.5));
        }
        this.indexMap.set(b, index);

        const idAttr = this.getAttribute('iconId') as InstancedBufferAttribute;
        const posAttr = this.getAttribute('iconPos') as InstancedBufferAttribute;
        const scaleAttr = this.getAttribute('iconScale') as InstancedBufferAttribute;

        const axisXAttr = this.getAttribute('iconAxisX') as InstancedBufferAttribute;
        const axisYAttr = this.getAttribute('iconAxisY') as InstancedBufferAttribute;

        (idAttr.array as Int32Array)[index] = iconId;
        pos.toArray(posAttr.array, index * 3);
        scale.toArray(scaleAttr.array, index * 2);
        (axes?.x ?? zero3).toArray(axisXAttr.array, index * 3);
        (axes?.y ?? zero3).toArray(axisYAttr.array, index * 3);
        const dimAttr = this.getAttribute('iconDim') as InstancedBufferAttribute;
        (dimAttr.array as Float32Array)[index] = this.dim?.(b) ? 1 : 0;
        dimAttr.needsUpdate = true;

        if (update) {
            updateAttr(idAttr, index);
            updateAttr(posAttr, index);
            updateAttr(scaleAttr, index);
            updateAttr(axisXAttr, index);
            updateAttr(axisYAttr, index);
        }
        this.instanceCount = index + 1;
    }

    /** 按建筑淡化图标：dim(b) 为 true 的图标变淡 */
    setDim(dim: ((b: BlueprintBuilding) => boolean) | null) {
        this.dim = dim;
        const attr = this.getAttribute('iconDim') as InstancedBufferAttribute;
        const arr = attr.array as Float32Array;
        arr.fill(0);
        if (dim) {
            for (const [b, i] of this.indexMap)
                arr[i] = dim(b) ? 1 : 0;
        }
        attr.needsUpdate = true;
    }

    updateIconId(b: BlueprintBuilding, iconId: number) {
        const index = this.indexMap.get(b);
        if (index === undefined)
            throw new Error('No icon to update')
        const idAttr = this.getAttribute('iconId') as InstancedBufferAttribute;
        (idAttr.array as Int32Array)[index] = iconId;
        updateAttr(idAttr, index);
    }
}
export class Icons extends Mesh<IconGeometry, IconsMaterial> {
    constructor(map: Texture, geometry: IconGeometry) {
        const material = new IconsMaterial(map);
        super(geometry, material);
    }
}
