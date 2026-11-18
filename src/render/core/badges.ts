import { Group, Matrix4, Vector2, Vector3, WebGLRenderer } from 'three';
import { BeltParameters, BlueprintBuilding } from '@/blueprint/parser';
import { calcBuildingTrans, PositionedBlueprint } from '@/blueprint/planet';
import { buildingMeta, noIconBuildings } from '@/data/building';
import { isBelt, isInserter } from '@/data/items';
import { itemIconId, recipeIconId } from '@/data/icons';
import { IconTexture } from '@/iconTexture';
import { IconGeometry, Icons } from '@/icons';
import { IconSubscript } from '@/iconSubscript';
import { Updater } from '@/command';
import { inserterHeight } from './pick';

export function buildingIconId(b: BlueprintBuilding) {
    return b.recipeId > 0 ? recipeIconId(b.recipeId) : itemIconId(b.itemId);
}

const ICON_LIFT = 0.04;
const ICON_FILL = 0.72;
const topCenter = new Vector3(0, 0.5, 0);
const m = new Matrix4();
const scale3 = new Vector3();

/** 方盒顶面中心与顶面方向（x 朝建筑右侧，y 朝建筑正前方） */
function buildingIconPlacement(b: BlueprintBuilding, buildingTrans: Matrix4, pos: Vector3, scale: Vector2, axes: { x: Vector3, y: Vector3 }) {
    const meta = buildingMeta.get(b.modelIndex);
    if (meta === undefined)
        return false;
    m.multiplyMatrices(buildingTrans, meta.unitBoxTrans);
    pos.copy(topCenter).applyMatrix4(m);
    pos.addScaledVector(pos.clone().normalize(), ICON_LIFT);
    scale3.setFromMatrixScale(meta.unitBoxTrans);
    const size = Math.min(scale3.x, scale3.z) * ICON_FILL;
    scale.set(size, size);
    axes.x.setFromMatrixColumn(buildingTrans, 0).normalize();
    axes.y.setFromMatrixColumn(buildingTrans, 1).normalize();
    return true;
}

const beltIconScale = new Vector2(1.1, 1.1);
const beltIconTrans = new Matrix4().makeTranslation(0., 0., 0.5);
function beltIconPos(buildingTrans: Matrix4, pos: Vector3) {
    m.multiplyMatrices(buildingTrans, beltIconTrans);
    pos.setFromMatrixPosition(m);
}

const sorterIconScale = new Vector2(0.8, 0.8);
const sorterIconTrans = new Matrix4().makeTranslation(0., 0., inserterHeight);
function sorterIconPos(buildingTrans: Matrix4, pos: Vector3) {
    m.multiplyMatrices(buildingTrans, sorterIconTrans);
    pos.setFromMatrixPosition(m);
}

export interface Badges {
    group: Group;
    icons: IconGeometry;
    iconTexture: IconTexture;
    dispose(): void;
}

/**
 * 图标：建筑的配方/建筑图标平铺在方盒顶面；传送带标记与分拣器过滤物品为悬浮图标，
 * 传送带计数为角标。
 */
export function buildBadges(renderer: WebGLRenderer, buildings: BlueprintBuilding[], transforms: Matrix4[][]): Badges {
    const boxes = buildings.filter(b => !isBelt(b.itemId) && !isInserter(b.itemId));
    const iconBuildings = boxes.filter(b => !noIconBuildings.has(b.itemId));
    const iconBelts = buildings.filter(b => isBelt(b.itemId) && b.parameters && (b.parameters as BeltParameters).iconId > 0);
    const iconInserters = buildings.filter(b => isInserter(b.itemId) && b.filterId > 0);

    const subscripts = new Map<BlueprintBuilding, string>();
    for (const b of iconBelts) {
        const p = b.parameters as BeltParameters;
        if (p.count === 0)
            continue;
        subscripts.set(b, p.count >= 100000 ? Math.floor(p.count / 1000).toFixed(0) + 'k' : p.count.toFixed(0));
    }

    const iconTexture = new IconTexture(renderer);
    const icons = new IconGeometry(Math.max(iconBuildings.length + iconBelts.length + iconInserters.length, 1));
    let subscriptsMesh: IconSubscript | null = null;
    if (subscripts.size > 0) {
        let numChars = 0;
        for (const s of subscripts.values())
            numChars += s.length;
        subscriptsMesh = new IconSubscript(numChars);
    }

    const pos = new Vector3();
    let subscriptIdx = 0;
    for (const b of iconBelts) {
        beltIconPos(transforms[b.index][0], pos);
        icons.addIcon(b, iconTexture.requestIcon((b.parameters as BeltParameters).iconId), pos, beltIconScale);
        const sub = subscripts.get(b);
        if (sub !== undefined) {
            subscriptsMesh!.setText(subscriptIdx, pos, beltIconScale, sub);
            subscriptIdx += sub.length;
        }
    }
    for (const b of iconInserters) {
        sorterIconPos(transforms[b.index][0], pos);
        icons.addIcon(b, iconTexture.requestIcon(itemIconId(b.filterId)), pos, sorterIconScale);
    }
    const scale = new Vector2();
    const axes = { x: new Vector3(), y: new Vector3() };
    for (const b of iconBuildings) {
        if (!buildingIconPlacement(b, transforms[b.index][0], pos, scale, axes))
            continue;
        icons.addIcon(b, iconTexture.requestIcon(buildingIconId(b)), pos, scale, false, axes);
    }

    const group = new Group();
    const iconsMesh = new Icons(iconTexture.texture, icons);
    iconsMesh.renderOrder = 10;
    iconsMesh.frustumCulled = false;
    group.add(iconsMesh);
    if (subscriptsMesh) {
        subscriptsMesh.needsUpdate();
        subscriptsMesh.renderOrder = 11;
        subscriptsMesh.frustumCulled = false;
        group.add(subscriptsMesh);
    }

    return {
        group, icons, iconTexture,
        dispose() {
            icons.dispose();
            iconsMesh.material.dispose();
            subscriptsMesh?.geometry.dispose();
            iconTexture.texture.dispose();
        },
    };
}

/** 编辑命令改了配方/标记/过滤物品后更新图标 */
export function registerIconUpdater(updater: Updater, badges: Badges, R: number, posBP: PositionedBlueprint) {
    updater.updateBuildingIcon.on(b => {
        const iconId = badges.iconTexture.requestIcon(buildingIconId(b));
        if (badges.icons.hasIcon(b))
            badges.icons.updateIconId(b, iconId);
    });

    updater.updateBeltIcon.on(b => {
        const iconId = b.parameters ? badges.iconTexture.requestIcon((b.parameters as BeltParameters).iconId) : 0;
        const icons = badges.icons;
        if (icons.hasIcon(b)) {
            icons.updateIconId(b, iconId);
        } else if (iconId != 0) {
            const pos = new Vector3();
            beltIconPos(calcBuildingTrans(R, posBP, b)[0], pos);
            icons.addIcon(b, iconId, pos, beltIconScale, true);
        }
    });

    updater.updateBeltIconSubscript.on(() => { throw new Error('Method not implemented.') });
    updater.updateSorterIcon.on(b => {
        const iconId = badges.iconTexture.requestIcon(itemIconId(b.filterId));
        const icons = badges.icons;
        if (icons.hasIcon(b)) {
            icons.updateIconId(b, iconId);
        } else if (iconId != 0) {
            const pos = new Vector3();
            sorterIconPos(calcBuildingTrans(R, posBP, b)[0], pos);
            icons.addIcon(b, iconId, pos, sorterIconScale, true);
        }
    });
}
