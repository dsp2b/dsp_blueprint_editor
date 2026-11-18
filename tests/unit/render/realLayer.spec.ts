import {
    BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera,
    Vector2, Vector3, WebGLRenderer,
} from 'three';
import { BlueprintArea, BlueprintBuilding, BlueprintData } from '@/blueprint/parser';
import { calcBuildingTrans, findPosForAreas } from '@/blueprint/planet';
import { IconGeometry } from '@/icons';
import { IconTexture } from '@/iconTexture';
import { createRealLayer } from '@/render/real';
import type { GLTFLike, ModelManifest } from '@/render/real/loader';
import type { LayerContext } from '@/render/layers';

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { jest.restoreAllMocks(); });
const flush = () => new Promise(r => setTimeout(r, 0));

const R = 200.2;
const AREAS: BlueprintArea[] = [{
    index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 200,
    anchorLocalOffset: { x: 0, y: 0 }, size: { x: 1, y: 1 },
}];

function building(index: number, itemId: number, modelIndex: number, x: number, extra: Partial<BlueprintBuilding> = {}): BlueprintBuilding {
    return {
        index, areaIndex: 0,
        localOffset: [{ x, y: 0, z: 0 }, { x, y: 0, z: 0 }],
        yaw: [0, 0], tilt: [0, 0], pitch: [0, 0],
        itemId, modelIndex,
        outputObjIdx: -1, inputObjIdx: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0,
        recipeId: 0, filterId: 0, parameters: null, content: null,
        ...extra,
    };
}

const IRON_RECIPE = 1;
const COPPER_RECIPE = 3;
/** 假图集：图标下标 = 图标 id − 1000（物品图标 id 即物品 id：铁块 1101 → 101，铜块 1104 → 104） */
const iconIndex = (iconId: number) => iconId - 1000;

/** 熔炉 → 分拣器 → 传送带，相机放在熔炉正上方 */
function smelterLine() {
    const smelter = building(0, 2302, 62, 0, { recipeId: IRON_RECIPE });
    const sorter = building(1, 2011, 41, 2, { inputObjIdx: 0, outputObjIdx: 2, inputFromSlot: 0, outputToSlot: -1 });
    sorter.localOffset = [{ x: 1.5, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }];
    const belt = building(2, 2001, 35, 3.5);
    const buildings = [smelter, sorter, belt];
    const data = { areas: AREAS, buildings } as unknown as BlueprintData;
    const pos = findPosForAreas(AREAS, 200);
    const transforms = buildings.map(b => calcBuildingTrans(R, pos, b));
    const camera = new PerspectiveCamera(50, 4 / 3, 0.5, 3000);
    const at = new Vector3().setFromMatrixPosition(transforms[0][0]);
    camera.position.copy(at).multiplyScalar(1 + 20 / R);
    camera.lookAt(at);
    const renderer = {
        domElement: { parentElement: null },
        getPixelRatio: () => 1,
        getDrawingBufferSize: (v: Vector2) => v.set(800, 600),
    } as unknown as WebGLRenderer;
    const icons = new IconGeometry(buildings.length);
    icons.addIcon(smelter, iconIndex(1101), at.clone(), new Vector2(1, 1));
    const ctx: LayerContext = {
        root: new Group(), renderer, camera, R, data, buildings, transforms, icons,
        iconTexture: { requestIcon: iconIndex, texture: null } as unknown as IconTexture,
        view: { flow: false, badges: true, reducedMotion: false },
    };
    const manifest = {
        buildings: { 62: { file: 'smelter.glb', bytes: 10, lodDistances: [100], lod0: { file: 'smelter-lod0.glb', bytes: 10 } } },
        sorters: { 'sorter-mk1': { file: 'sorter.glb', bytes: 10 } },
    } as unknown as ModelManifest;
    return { ctx, smelter, manifest };
}

const meshNamed = (name: string) => {
    const m = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshStandardMaterial());
    m.name = name;
    return m;
};
const gltf = (...names: string[]): GLTFLike => {
    const scene = new Group();
    for (const n of names)
        scene.add(meshNamed(n));
    return { scene };
};
const loadGlb = async (path: string) => path.startsWith('sorter')
    ? gltf('ACap', 'BCap', 'grabber', 'grabberLoaded')
    : gltf(path.includes('lod0') ? 'body-lod0' : 'body');

function find(root: Object3D, test: (o: Object3D) => boolean): InstancedMesh[] {
    const out: InstancedMesh[] = [];
    root.traverse(o => { if ((o as InstancedMesh).isInstancedMesh && test(o)) out.push(o as InstancedMesh); });
    return out;
}
const decalIcons = (root: Object3D) => {
    const [decal] = find(root, o => o.name === 'icon' && o.parent?.name === 'sorter-41');
    const attr = decal.geometry.getAttribute('cargoIcon') as InstancedBufferAttribute;
    return Array.from(attr.array).slice(0, decal.count);
};
const topIcon = (icons: IconGeometry, i = 0) => (icons.getAttribute('iconId') as InstancedBufferAttribute).array[i];

async function shown() {
    const s = smelterLine();
    const layer = createRealLayer({ loadManifest: async () => s.manifest, loadGlb });
    layer.build(s.ctx);
    layer.setVisible(true);
    await flush();
    await flush();
    return { ...s, layer };
}

describe('real model layer: camera, edits and hover', () => {
    test('assigns LOD from the context camera on update, without needing a render pass', async () => {
        const { ctx, layer } = await shown();
        layer.update(1 / 60);
        const near = find(ctx.root, o => o.name === 'lod0' && o.parent?.name === 'model-62');
        expect(near.length).toBeGreaterThan(0);
        expect(near[0].count).toBe(1);
        layer.dispose();
    });

    test('re-infers what sorters carry after an edit changes the upstream recipe', async () => {
        const { ctx, smelter, layer } = await shown();
        layer.update(0);
        expect(decalIcons(ctx.root)).toEqual([iconIndex(1101)]);
        smelter.recipeId = COPPER_RECIPE;
        layer.dataChanged?.();
        layer.update(0);
        expect(decalIcons(ctx.root)).toEqual([iconIndex(1104)]);
        layer.dispose();
    });

    test('keeps the top icon hidden on a real model after an icon update that did not change the icon', async () => {
        const { ctx, smelter, layer } = await shown();
        layer.update(0);
        expect(topIcon(ctx.icons)).toBe(0);
        // registerIconUpdater 收到编辑事件时总把顶面图标写回来，即使图标没变（配方改成同一个）
        ctx.icons.updateIconId(smelter, iconIndex(1101));
        layer.dataChanged?.();
        layer.update(0);
        expect(topIcon(ctx.icons)).toBe(0);
        layer.dispose();
    });

    test('tints a hovered or selected sorter like other real-model parts', async () => {
        const { ctx, layer } = await shown();
        layer.update(0);
        const [grabber] = find(ctx.root, o => o.name === 'grabber' && o.parent?.name === 'sorter-41');
        const color = () => grabber.instanceColor ? Array.from(grabber.instanceColor.array.slice(0, 3)) : [1, 1, 1];
        expect(color()).toEqual([1, 1, 1]);
        layer.setHover?.(1);
        layer.update(0);
        const hovered = color();
        expect(hovered).not.toEqual([1, 1, 1]);
        layer.setHover?.(null);
        layer.setSelected?.(new Set([1]));
        layer.update(0);
        expect(color()).not.toEqual([1, 1, 1]);
        expect(color()).not.toEqual(hovered);
        layer.dispose();
    });
});
