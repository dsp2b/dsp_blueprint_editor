import { BoxGeometry, Color, CylinderGeometry, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D, Vector3 } from 'three';
import { BlueprintBuilding } from '@/blueprint/parser';
import { buildingMeta } from '@/data/building';
import { isBelt, isInserter } from '@/data/items';
import { Cargos } from '@/cargos';
import { inserterTrans } from '../core/pick';
import { TIER_COLORS, tierOf } from '../core/tiers';
import type { Layer, LayerContext } from '../layers';

const FALLBACK = new Color(0xdddddd);
const DIM_OPACITY = 0.3;

function linkColor(b: BlueprintBuilding) {
    const tier = tierOf(b.itemId);
    return tier ? TIER_COLORS[tier] : buildingMeta.get(b.modelIndex)?.color ?? FALLBACK;
}

/**
 * 精简模式的传送带与分拣器。
 * 目前沿用原来的圆片 + 连杆 + 货物动画，按等级着色；传送带条带与分拣器弧线由后续实现替换。
 */
export function createLinksLayer(): Layer {
    let ctx: LayerContext | null = null;
    const materials: MeshLambertMaterial[] = [];
    let cargos: Cargos | null = null;
    const meshes: InstancedMesh[] = [];
    const modelRef = new Map<number, { mesh: InstancedMesh, instance: number }>();
    let cargoTime = 0;

    const buildBelts = (c: LayerContext, belts: BlueprintBuilding[], addCargo: (t: Matrix4, color: Color, d: number) => void) => {
        const thickness = 0.1;
        const material = new MeshLambertMaterial();
        materials.push(material);
        const objects: Object3D[] = [];
        {
            const geometry = new CylinderGeometry(0.32, 0.32, thickness, 8);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            const offset = new Matrix4().makeRotationX(Math.PI / 2);
            offset.premultiply(new Matrix4().makeTranslation(0, 0, thickness / 2));
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b = belts[i];
                trans.copy(c.transforms[b.index][0]);
                trans.multiply(offset);
                mesh.setMatrixAt(i, trans);
                mesh.setColorAt(i, linkColor(b));
                modelRef.set(b.index, { mesh, instance: i });
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
            meshes.push(mesh);
            objects.push(mesh);
        }
        const linkThickness = 0.6 * thickness;
        { // 相邻传送带之间的连杆
            const geometry = new BoxGeometry(0.15, linkThickness, 1.0);
            const mesh = new InstancedMesh(geometry, material, belts.length);
            let numLinks = 0;
            const offset = new Matrix4().makeTranslation(0, linkThickness / 2, -0.5);
            const pos1 = new Vector3();
            const pos2 = new Vector3();
            const dir = new Vector3();
            const temp = new Matrix4();
            const trans = new Matrix4();
            for (let i = 0; i < belts.length; i++) {
                const b1 = belts[i];
                if (b1.outputObjIdx < 0 || !c.transforms[b1.outputObjIdx])
                    continue;
                pos1.setFromMatrixPosition(c.transforms[b1.index][0]);
                pos2.setFromMatrixPosition(c.transforms[b1.outputObjIdx][0]);
                const len = dir.subVectors(pos1, pos2).length();
                trans.identity();
                trans.lookAt(pos1, pos2, pos1);
                trans.premultiply(temp.makeTranslation(pos1.x, pos1.y, pos1.z));

                const color = linkColor(b1);
                addCargo(trans, color, len);

                trans.multiply(temp.makeScale(1., 1., len));
                trans.multiply(offset);
                mesh.setMatrixAt(numLinks, trans);
                mesh.setColorAt(numLinks, color);
                numLinks++;
            }
            if (numLinks) {
                mesh.count = numLinks;
                mesh.instanceMatrix.needsUpdate = true;
                mesh.instanceColor!.needsUpdate = true;
                meshes.push(mesh);
                objects.push(mesh);
            } else {
                mesh.dispose();
                geometry.dispose();
            }
        }
        return objects;
    };

    const buildInserters = (c: LayerContext, inserters: BlueprintBuilding[], addCargo: (t: Matrix4, color: Color, d: number) => void) => {
        const inserterThickness = 0.06;
        const geometry = new BoxGeometry(0.15, inserterThickness, 1.0);
        const material = new MeshLambertMaterial();
        materials.push(material);
        const mesh = new InstancedMesh(geometry, material, inserters.length);
        const offset = new Matrix4().makeTranslation(0, 0, -0.5);
        const temp = new Matrix4();
        const trans = new Matrix4();
        for (let i = 0; i < inserters.length; i++) {
            const b = inserters[i];
            const len = inserterTrans(c.transforms[b.index], trans);
            const color = linkColor(b);
            addCargo(trans, color, len);

            trans.multiply(temp.makeScale(1., 1., len));
            trans.multiply(offset);
            mesh.setMatrixAt(i, trans);
            mesh.setColorAt(i, color);
            modelRef.set(b.index, { mesh, instance: i });
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.needsUpdate = true;
        meshes.push(mesh);
        return [mesh];
    };

    return {
        build(c) {
            ctx = c;
            const belts = c.buildings.filter(b => isBelt(b.itemId));
            const inserters = c.buildings.filter(b => isInserter(b.itemId));
            if (belts.length + inserters.length === 0)
                return;

            const cargosMesh = new Cargos(belts.length + inserters.length);
            let numCargos = 0;
            const addCargo = (trans: Matrix4, color: Color, distance: number) => {
                cargosMesh.setMatrixAt(numCargos, trans);
                cargosMesh.setColorAt(numCargos, color);
                cargosMesh.setCargoDistanceAt(numCargos, distance);
                numCargos++;
            };
            if (belts.length)
                c.root.add(...buildBelts(c, belts, addCargo));
            if (inserters.length)
                c.root.add(...buildInserters(c, inserters, addCargo));

            if (numCargos) {
                cargosMesh.count = numCargos;
                cargosMesh.instanceMatrix.needsUpdate = true;
                cargosMesh.instanceColor!.needsUpdate = true;
                cargosMesh.geometry.cargoDistance.needsUpdate = true;
                cargos = cargosMesh;
                materials.push(cargosMesh.material);
                c.root.add(cargosMesh);
            } else {
                cargosMesh.dispose();
                cargosMesh.geometry.dispose();
                cargosMesh.material.dispose();
            }
        },
        update(dt) {
            if (!cargos || !ctx)
                return;
            // 关闭流向或要求减少动态效果时货物停在原处
            if (ctx.view.flow)
                cargoTime = (cargoTime + dt) % 1;
            cargos.cargoMove = cargoTime;
        },
        dispose() {
            for (const m of meshes) {
                m.geometry.dispose();
                m.dispose();
            }
            if (cargos) {
                cargos.geometry.dispose();
                cargos.dispose();
            }
            for (const m of materials)
                m.dispose();
            meshes.length = 0;
            materials.length = 0;
            modelRef.clear();
            cargos = null;
            ctx = null;
        },
        setVisible(visible) {
            if (ctx)
                ctx.root.visible = visible;
        },
        setHighlight(mask) {
            for (const m of materials) {
                m.transparent = mask !== null;
                m.opacity = mask !== null ? DIM_OPACITY : 1;
                m.depthWrite = mask === null;
                m.needsUpdate = true;
            }
        },
        modelOf(index) {
            const ref = modelRef.get(index);
            if (!ref)
                return null;
            const m = new Matrix4();
            ref.mesh.getMatrixAt(ref.instance, m);
            return m;
        },
    };
}
