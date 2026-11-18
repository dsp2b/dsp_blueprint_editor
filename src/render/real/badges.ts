import {
    BufferGeometry, Camera, Color, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
    ShaderMaterial, SRGBColorSpace, Texture, Vector2, Vector3,
} from 'three';
import { IconTexture } from '@/iconTexture';

/**
 * 屏幕空间的重叠剔除：按 depth 从近到远依次放置，和已放置的标记中心距离小于 size 的隐藏。
 * candidate 为 0 的（屏幕外、在星球背面）直接隐藏。返回每个标记是否显示（1/0）。
 */
export function cullOverlaps(
    xs: ArrayLike<number>, ys: ArrayLike<number>, depth: ArrayLike<number>,
    candidate: ArrayLike<number | boolean>, size: number,
): Uint8Array {
    const n = xs.length;
    const visible = new Uint8Array(n);
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
        if (candidate[i])
            order.push(i);
    }
    order.sort((a, b) => depth[a] - depth[b]);

    // 以 size 为边长的网格，只需比较周围 3×3 格
    const grid = new Map<string, number[]>();
    const size2 = size * size;
    for (const i of order) {
        const cx = Math.floor(xs[i] / size);
        const cy = Math.floor(ys[i] / size);
        let free = true;
        for (let dx = -1; dx <= 1 && free; dx++) {
            for (let dy = -1; dy <= 1 && free; dy++) {
                for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
                    const ex = xs[i] - xs[j], ey = ys[i] - ys[j];
                    if (ex * ex + ey * ey < size2) {
                        free = false;
                        break;
                    }
                }
            }
        }
        if (!free)
            continue;
        visible[i] = 1;
        const key = `${cx},${cy}`;
        const cell = grid.get(key);
        if (cell)
            cell.push(i);
        else
            grid.set(key, [i]);
    }
    return visible;
}

/** 标记直径（CSS 像素） */
export const BADGE_PX = 30;
/** 两个标记中心距离小于直径的这个比例时算重叠 */
const OVERLAP = 0.9;
const HOLO = new Color(0x7FD8FF);
const BG = new Color().setRGB(10 / 255, 18 / 255, 30 / 255, SRGBColorSpace);

export interface BadgeItem {
    /** 建筑 index */
    index: number;
    /** 图标在图集里的位置（IconTexture.requestIcon 的返回值） */
    icon: number;
    pos: Vector3;
    /** 等级色，没有等级为 null */
    ring: Color | null;
}

class BadgeMaterial extends ShaderMaterial {
    constructor(map: Texture | undefined) {
        super({
            uniforms: {
                map: { value: map ?? null },
                iMapSize: { value: new Vector2(IconTexture.WIDTH, IconTexture.HEIGHT) },
                uViewport: { value: new Vector2(1, 1) },
                uSize: { value: BADGE_PX },
                uBg: { value: BG },
            },
            vertexShader: `
attribute vec3 badgePos;
attribute float badgeIcon;
attribute vec3 badgeRing;
attribute float badgeShow;
attribute float badgeDim;
uniform vec2 uViewport;
uniform float uSize;
uniform vec2 iMapSize;
varying vec2 vUv;
varying vec2 vCell;
varying vec3 vRing;
varying float vDim;

void main() {
	vUv = uv;
	float id = floor(badgeIcon + 0.5);
	vCell = vec2(mod(id, iMapSize.x), floor(id / iMapSize.x));
	vRing = badgeRing;
	vDim = badgeDim;
	vec4 clip = projectionMatrix * modelViewMatrix * vec4(badgePos, 1.0);
	// 屏幕上固定像素大小
	clip.xy += position.xy * badgeShow * uSize * 2.0 / uViewport * clip.w;
	gl_Position = clip;
}`,
            fragmentShader: `
uniform sampler2D map;
uniform vec2 iMapSize;
uniform vec3 uBg;
varying vec2 vUv;
varying vec2 vCell;
varying vec3 vRing;
varying float vDim;

void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length(p);
	float aa = fwidth(r);
	float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);
	if (alpha <= 0.0)
		discard;
	vec3 color = uBg;
	float a = 0.88;
	float ring = smoothstep(0.8 - aa, 0.8, r);
	color = mix(color, vRing, ring);
	a = mix(a, 1.0, ring);
	vec2 q = p / 1.24 + 0.5;
	if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
		vec4 icon = texture2D(map, (q + vCell) / iMapSize);
		color = mix(color, icon.rgb, icon.a * (1.0 - ring));
	}
	gl_FragColor = vec4(color, a * alpha * (1.0 - 0.85 * vDim));
	#include <colorspace_fragment>
}`,
        });
        this.transparent = true;
        this.depthTest = false;
        this.depthWrite = false;
    }
}

const ndc = new Vector3();
const toCam = new Vector3();
const camPos = new Vector3();

/**
 * 真实模型模式的悬浮配方标记：模型上方固定屏幕大小的圆形标记（配方图标 + 等级色环），
 * 一次绘制。缩小视图时互相重叠的标记自动隐藏，在星球背面的也隐藏。
 */
export class FloatingBadges {
    readonly mesh: Mesh<InstancedBufferGeometry, BadgeMaterial>;
    private items: BadgeItem[] = [];
    private slot = new Map<number, number>();
    private dirty = true;
    private lastView: number[] = [];

    /** capacity：最多的标记数（显示前一次分配好，three 只在第一次绘制时记录实例上限） */
    constructor(map: Texture | undefined, readonly capacity: number) {
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
        geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const n = Math.max(capacity, 1);
        geometry.setAttribute('badgePos', new InstancedBufferAttribute(new Float32Array(n * 3), 3));
        geometry.setAttribute('badgeIcon', new InstancedBufferAttribute(new Float32Array(n), 1));
        geometry.setAttribute('badgeRing', new InstancedBufferAttribute(new Float32Array(n * 3), 3));
        geometry.setAttribute('badgeShow', new InstancedBufferAttribute(new Float32Array(n), 1));
        geometry.setAttribute('badgeDim', new InstancedBufferAttribute(new Float32Array(n), 1));
        geometry.instanceCount = 0;
        this.mesh = new Mesh(geometry, new BadgeMaterial(map));
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 20;
        this.mesh.name = 'badges';
    }

    get count() {
        return this.items.length;
    }

    /** 加入一批标记（某类建筑的模型下载完成时）；超出容量的忽略 */
    add(items: BadgeItem[]) {
        const g = this.mesh.geometry;
        const pos = g.getAttribute('badgePos') as InstancedBufferAttribute;
        const icon = g.getAttribute('badgeIcon') as InstancedBufferAttribute;
        const ring = g.getAttribute('badgeRing') as InstancedBufferAttribute;
        for (const it of items) {
            const i = this.items.length;
            if (i >= this.capacity)
                break;
            this.items.push(it);
            this.slot.set(it.index, i);
            pos.setXYZ(i, it.pos.x, it.pos.y, it.pos.z);
            icon.setX(i, it.icon);
            const c = it.ring ?? HOLO;
            ring.setXYZ(i, c.r, c.g, c.b);
        }
        pos.needsUpdate = icon.needsUpdate = ring.needsUpdate = true;
        g.instanceCount = this.items.length;
        this.dirty = true;
    }

    setIcon(index: number, icon: number) {
        const i = this.slot.get(index);
        if (i === undefined)
            return;
        this.items[i].icon = icon;
        const attr = this.mesh.geometry.getAttribute('badgeIcon') as InstancedBufferAttribute;
        attr.setX(i, icon);
        attr.needsUpdate = true;
    }

    /** mask[index] 为 0 的标记变淡；null 取消 */
    setDim(mask: Uint8Array | null) {
        const attr = this.mesh.geometry.getAttribute('badgeDim') as InstancedBufferAttribute;
        this.items.forEach((it, i) => attr.setX(i, mask !== null && !mask[it.index] ? 1 : 0));
        attr.needsUpdate = true;
    }

    /**
     * 按当前相机重新决定哪些标记显示；相机、画布和标记都没变时不做事。
     * width/height 为画布的绘制缓冲像素，pixelRatio 把 BADGE_PX 换成绘制像素。
     */
    cull(camera: Camera, width: number, height: number, pixelRatio: number) {
        const view = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, width, height, pixelRatio];
        if (!this.dirty && view.length === this.lastView.length && view.every((v, i) => v === this.lastView[i]))
            return;
        this.dirty = false;
        this.lastView = view;
        const size = BADGE_PX * pixelRatio;
        this.mesh.material.uniforms.uViewport.value.set(width, height);
        this.mesh.material.uniforms.uSize.value = size;

        const n = this.items.length;
        const xs = new Float32Array(n), ys = new Float32Array(n), depth = new Float32Array(n);
        const candidate = new Uint8Array(n);
        camPos.setFromMatrixPosition(camera.matrixWorld);
        this.items.forEach((it, i) => {
            depth[i] = toCam.subVectors(camPos, it.pos).length();
            // 在星球背面（相机在标记所在切平面之下）
            if (toCam.dot(it.pos) <= 0)
                return;
            ndc.copy(it.pos).project(camera);
            if (ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05)
                return;
            xs[i] = (ndc.x + 1) / 2 * width;
            ys[i] = (1 - ndc.y) / 2 * height;
            candidate[i] = 1;
        });
        const visible = cullOverlaps(xs, ys, depth, candidate, size * OVERLAP);
        const show = this.mesh.geometry.getAttribute('badgeShow') as InstancedBufferAttribute;
        (show.array as Float32Array).set(visible);
        show.needsUpdate = true;
    }

    /** 当前显示的标记数（调试/测试用） */
    visibleCount() {
        const show = this.mesh.geometry.getAttribute('badgeShow').array as Float32Array;
        return show.reduce((a, b) => a + b, 0);
    }

    dispose() {
        (this.mesh.geometry as BufferGeometry).dispose();
        this.mesh.material.dispose();
    }
}
