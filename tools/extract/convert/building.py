"""src/data/building.ts: per-model selection box, tint, slot poses and work parameters from the game's
SlotConfig/material/PrefabDesc (buildings.json), replacing the hand-written table.

The only hand-maintained part is OVERRIDES: preview-only tweaks of the belt and sorter boxes. Each states why."""

_BELT_REASON = ("belts are previewed as a flat strip narrower than the game's 1.0 x 0.5 selection box so that "
                "neighbouring belts stay distinguishable; the game material has no _Color, so the tier colour "
                "is kept here too")
_SORTER_REASON = ("sorters are previewed as a unit cube centred on the build point instead of the game box "
                  "lifted by half its height, so the sorter sits flat between its two buildings")

OVERRIDES = {
    35: {"box": [0.64, 0.12, 0.64], "offset": [0.0, 0.05, 0.0], "color": 0xE3A263, "reason": _BELT_REASON},
    36: {"box": [0.64, 0.12, 0.64], "offset": [0.0, 0.05, 0.0], "color": 0x51A896, "reason": _BELT_REASON},
    37: {"box": [0.64, 0.12, 0.64], "offset": [0.0, 0.05, 0.0], "color": 0x61A5D7, "reason": _BELT_REASON},
    41: {"box": [1.0, 1.0, 1.0], "offset": [0.0, 0.0, 0.0], "reason": _SORTER_REASON},
    42: {"box": [1.0, 1.0, 1.0], "offset": [0.0, 0.0, 0.0], "reason": _SORTER_REASON},
    43: {"box": [1.0, 1.0, 1.0], "offset": [0.0, 0.0, 0.0], "reason": _SORTER_REASON},
    483: {"box": [1.0, 1.0, 1.0], "offset": [0.0, 0.0, 0.0], "reason": _SORTER_REASON},
}

# PrefabDesc field -> name in buildingMeta.work. Values are the game's raw numbers (assemblerSpeed 10000 = 1x,
# inserterSpeed is PrefabDesc.inserterSTT, minerSpeed is PrefabDesc.minerPeriod).
WORK_FIELDS = {
    "assemblerSpeed": "assemblerSpeed",
    "labAssembleSpeed": "labSpeed",
    "beltSpeed": "beltSpeed",
    "inserterSTT": "inserterSpeed",
    "minerPeriod": "minerSpeed",
}


def _hex(tint):
    return int(round(tint[0] * 255)) << 16 | int(round(tint[1] * 255)) << 8 | int(round(tint[2] * 255))


def _names(buildings):
    names = {}
    for it in buildings.get("items", []):
        if it["modelIndex"] > 0:
            for m in range(it["modelIndex"], it["modelIndex"] + it["modelCount"]):
                names.setdefault(m, it["name"])
    return names


def build_models(buildings):
    names = _names(buildings)
    out = []
    for m in sorted(buildings["models"], key=lambda m: m["modelIndex"]):
        idx = m["modelIndex"]
        box, offset = list(m["selectSize"]), list(m["selectCenter"])
        color = _hex(m["tint"]) if m.get("tint") else None
        ov = OVERRIDES.get(idx)
        if ov:
            box, offset = list(ov["box"]), list(ov["offset"])
            color = ov.get("color", color)
        work = {new: m["work"][old] for old, new in WORK_FIELDS.items() if old in m.get("work", {})}
        out.append({"modelIndex": idx, "name": names.get(idx, ""), "box": box, "offset": offset, "color": color,
                    "slotPoses": m.get("slotPoses", []), "insertPoses": m.get("insertPoses", []),
                    "work": work, "overridden": ov is not None})
    return out


def _f(x):
    s = repr(round(float(x), 7))
    return "0.0" if s == "-0.0" else s


def _vec(v):
    return "[" + ", ".join(_f(x) for x in v) + "]"


def _poses(poses):
    return "[" + ", ".join(f"{{pos: {_vec(p['pos'])}, rot: {_vec(p['rot'])}}}" for p in poses) + "]"


def _row(m):
    color = "null" if m["color"] is None else f"0x{m['color']:06X}"
    work = ", ".join(f"{k}: {v}" for k, v in m["work"].items())
    row = (f"    [{m['modelIndex']:>3}, {{ color: {color}, box: {_vec(m['box'])}, offset: {_vec(m['offset'])}, "
           f"slotPoses: {_poses(m['slotPoses'])}, insertPoses: {_poses(m['insertPoses'])}, "
           f"work: {{{work}}} }}],")
    return row + (f" // {m['name']}" if m["name"] else "")


HEADER = """// Generated file, do not edit. Regenerate with:
//   python -m tools.extract --out <dir> convert --preview-data src/data
// Source: game {version} (SlotConfig selectSize/selectCenter/slotPoses/insertPoses, material _Color, PrefabDesc work
// parameters). Preview-only box overrides live in tools/extract/convert/building.py (OVERRIDES).
import { Color, Matrix4 } from 'three';

/** Root-relative pose in the game's own (Y-up, left-handed) model space. */
export interface Pose {
    pos: [number, number, number];
    rot: [number, number, number, number];
}

/** Raw PrefabDesc numbers: assemblerSpeed 10000 = 1x, inserterSpeed = inserterSTT, minerSpeed = minerPeriod. */
export interface BuildingWork {
    assemblerSpeed?: number;
    labSpeed?: number;
    beltSpeed?: number;
    inserterSpeed?: number;
    minerSpeed?: number;
}

export interface BuildingMeta {
    color: Color;
    unitBoxTrans: Matrix4;
    selectUnitBoxTrans: Matrix4;
    iconTrans: Matrix4;
    slotPoses: Pose[];
    insertPoses: Pose[];
    work: BuildingWork;
}

interface BuildingMetaRaw {
    color: number | null;
    box: [number, number, number];
    offset: [number, number, number];
    slotPoses: Pose[];
    insertPoses: Pose[];
    work: BuildingWork;
}

// 'box' is selectSize and 'offset' is selectCenter of the SlotConfig; 'color' is the material tint (sRGB hex)
const buildingMetaRaw: [number, BuildingMetaRaw][] = [
"""

FOOTER = """];

export const buildingMeta = new Map<number, BuildingMeta>();

for (const [id, d] of buildingMetaRaw) {
    const unitBoxTrans = new Matrix4();
    const iconTrans = new Matrix4();
    const temp = new Matrix4();
    unitBoxTrans.makeTranslation(d.offset[0], d.offset[1], -d.offset[2]);
    unitBoxTrans.premultiply(temp.makeRotationX(Math.PI / 2));
    const selectUnitBoxTrans = unitBoxTrans.clone();

    unitBoxTrans.multiply(temp.makeScale(d.box[0] * 0.9, d.box[1] * 0.999, d.box[2] * 0.9));
    selectUnitBoxTrans.multiply(temp.makeScale(d.box[0], d.box[1], d.box[2]));

    const iconHeight = d.box[1] < 4.0 ? d.box[1] / 2.0 : d.box[1] - 2.0;
    iconTrans.makeScale(2., 2., 1.)
    iconTrans.premultiply(temp.makeTranslation(d.offset[0], d.offset[2], iconHeight));

    buildingMeta.set(id, {
        color: new Color(d.color ?? 0xdddddd),
        unitBoxTrans,
        selectUnitBoxTrans,
        iconTrans,
        slotPoses: d.slotPoses,
        insertPoses: d.insertPoses,
        work: d.work,
    });
}

export const noIconBuildings = new Set<number>([
    2020, // 四向分流器
    2040, // 自动集装机
    2030, // 流速监测器
    2313, // 喷涂机
    2201, // 电力感应塔
    2202, // 无线输电塔
])

export const stationSlotTrans = (function () {
    const o1 = 1.256, o2 = 2.7;
    const slots = [
        [ o1,  o2], [  0,  o2], [-o1,  o2],
        [-o2,  o1], [-o2,   0], [-o2, -o1],
        [-o1, -o2], [  0, -o2], [ o1, -o2],
        [ o2, -o1], [ o2,   0], [ o2,  o1],
    ] as const;
    return slots.map(s => new Matrix4().makeTranslation(s[0], s[1], 0.));
})();
"""


def building_ts(buildings, version):
    rows = "\n".join(_row(m) for m in build_models(buildings))
    return HEADER.replace("{version}", version) + rows + "\n" + FOOTER
