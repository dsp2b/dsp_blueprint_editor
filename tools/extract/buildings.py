"""Per-model building metadata, mirroring what the game's PrefabDesc constructor reads from a prefab.

SlotConfig gives the selection box and the connection (slotPoses) / sorter insert (insertPoses)
transforms; the first active Renderer's first material gives the tint (`_Color`); the *Desc
components give the work parameters (PrefabDesc.cs, `new PrefabDesc(id, prefab)`).
"""
import struct

from .errors import ExtractError
from .prefab import RENDERER_TYPES

# MonoBehaviour classes whose type trees the reader must provide.
WORK_SCRIPTS = (
    "BeltDesc", "SplitterDesc", "MonitorDesc", "SpeakerDesc", "SpraycoaterDesc", "PilerDesc", "StorageDesc",
    "TankDesc", "MinerDesc", "InserterDesc", "AssemblerDesc", "FractionatorDesc", "LabDesc", "StationDesc",
    "DispenserDesc", "MarkerDesc", "EjectorDesc", "SiloDesc", "AnimDesc", "PowerDesc",
)
SCRIPTS = frozenset(("SlotConfig",) + WORK_SCRIPTS)


def _to_f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def f32(x):
    """Shortest decimal that reads back as the same float32 (0.6000000238418579 -> 0.6)."""
    v = _to_f32(float(x))
    if v == 0:
        return 0.0
    for digits in range(1, 10):
        s = float(f"{v:.{digits}g}")
        if _to_f32(s) == v:
            return s
    return v


def _vec(d):
    return [f32(d["x"]), f32(d["y"]), f32(d["z"])]


def _round_to_int(a, b):
    """Mathf.RoundToInt(a * b) with float32 operands (C# float maths, banker's rounding)."""
    return int(round(_to_f32(_to_f32(a) * _to_f32(b))))


# ---------------------------------------------------------------- transforms

def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def _rotate(q, v):
    x, y, z, w = q
    tx, ty, tz = 2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty),
            v[1] + w * ty + (z * tx - x * tz),
            v[2] + w * tz + (x * ty - y * tx))


def _chain(root, target_id):
    if root.id == target_id:
        return [root]
    for c in root.children:
        sub = _chain(c, target_id)
        if sub:
            return [root] + sub
    return None


def pose_relative_to_root(root, transform_id):
    """(position, rotation) of a descendant Transform in the prefab root's local space."""
    chain = _chain(root, transform_id)
    if chain is None:
        raise ExtractError(f"transform {transform_id} is not part of prefab {root.name}")
    pos, rot, scale = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), (1.0, 1.0, 1.0)
    for n in chain[1:]:
        local = (scale[0] * n.pos[0], scale[1] * n.pos[1], scale[2] * n.pos[2])
        off = _rotate(rot, local)
        pos = (pos[0] + off[0], pos[1] + off[1], pos[2] + off[2])
        rot = _qmul(rot, n.rot)
        scale = (scale[0] * n.scale[0], scale[1] * n.scale[1], scale[2] * n.scale[2])
    return [f32(c) for c in pos], [f32(c) for c in rot]


# ---------------------------------------------------------------- components

def find_script(root, script):
    """Type tree of the first `script` MonoBehaviour in pre-order, inactive objects included
    (GetComponentInChildren<T>(true))."""
    for n in root.walk():
        for c in n.components:
            if c.kind == "MonoBehaviour" and c.script == script:
                return c.data if c.data is not None else {}
    return None


def main_tint(root):
    """`_Color` of the first material of the first Renderer on an active object
    (GetComponentInChildren<Renderer>().sharedMaterials[0]), or None."""
    for n in root.walk(active_only=True):
        for c in n.components:
            if c.kind not in RENDERER_TYPES:
                continue
            mats = c.materials() if c.materials else []
            color = (mats[0] or {}).get("colors", {}).get("_Color") if mats else None
            return [f32(x) for x in color] if color else None
    return None


def _copy(w, d, pairs, conv=lambda v: v):
    for out, src in pairs:
        if src in d:
            w[out] = conv(d[src])


def work_params(find):
    """PrefabDesc work fields, using the same names and unit conversions as the game."""
    w = {}
    belt, splitter, monitor = find("BeltDesc"), find("SplitterDesc"), find("MonitorDesc")
    if belt is not None:
        _copy(w, belt, [("beltPrototype", "beltPrototype"), ("beltSpeed", "speed")])
        w["isBelt"] = w.get("beltSpeed", 0) > 0
    elif splitter is not None:
        w["isSplitter"] = True
    elif monitor is not None:
        w["isMonitor"] = True
    if find("SpeakerDesc") is not None:
        w["isSpeaker"] = True
    if (d := find("SpraycoaterDesc")) is not None:
        w["isSpraycoster"] = True
        _copy(w, d, [("incCapacity", "incCapacity"), ("incItemId", "incItemId")])
    if find("PilerDesc") is not None:
        w["isPiler"] = True
    if (d := find("StorageDesc")) is not None:
        _copy(w, d, [("storageCol", "colCount"), ("storageRow", "rowCount")])
        w["isStorage"] = w.get("storageCol", 0) * w.get("storageRow", 0) > 0
    if (d := find("TankDesc")) is not None:
        w["isTank"] = True
        _copy(w, d, [("fluidStorageCount", "fluidStorageCount")])
    if (d := find("MinerDesc")) is not None:
        _copy(w, d, [("minerType", "minerType")])
        w["minerPeriod"] = _round_to_int(d.get("periodf", 0.0), 600000.0)
    if (d := find("InserterDesc")) is not None:
        _copy(w, d, [("inserterGrade", "grade"), ("inserterStackSize", "stackSize")])
        w["inserterSTT"] = _round_to_int(d.get("sttf", 1.0), 600000.0)
        w["inserterDelay"] = _round_to_int(d.get("delayf", 0.0), 600000.0)
        w["inserterCanStack"] = bool(d.get("canStack", 0))
        w["isInserter"] = w["inserterSTT"] > 0
    if (d := find("AssemblerDesc")) is not None:
        w["assemblerSpeed"] = _round_to_int(d.get("speedf", 0.0), 10000.0)
        _copy(w, d, [("assemblerRecipeType", "recipeType")])
        w["isAssembler"] = w.get("assemblerRecipeType", 0) != 0
    if (d := find("FractionatorDesc")) is not None:
        w["isFractionator"] = True
        _copy(w, d, [("fracFluidInputMax", "fluidInputMax"), ("fracProductOutputMax", "productOutputMax"),
                     ("fracFluidOutputMax", "fluidOutputMax"), ("assemblerRecipeType", "recipeType")])
    if (d := find("LabDesc")) is not None:
        w["isLab"] = True
        w["labAssembleSpeed"] = _round_to_int(d.get("assembleSpeed", 0.0), 10000.0)
        _copy(w, d, [("labResearchSpeed", "researchSpeed")], f32)
    if (d := find("StationDesc")) is not None:
        w["isStation"] = True
        _copy(w, d, [("isStellarStation", "isStellar"), ("isCollectStation", "isCollector"),
                     ("isVeinCollector", "isVeinCollector")], bool)
        _copy(w, d, [("stationMaxItemCount", "maxItemCount"), ("stationMaxItemKinds", "maxItemKinds"),
                     ("stationMaxDroneCount", "maxDroneCount"), ("stationMaxShipCount", "maxShipCount"),
                     ("stationMaxEnergyAcc", "maxEnergyAcc"), ("stationCollectSpeed", "collectSpeed")])
    if (d := find("DispenserDesc")) is not None:
        w["isDispenser"] = True
        _copy(w, d, [("dispenserMaxCourierCount", "maxCourierCount"), ("dispenserMaxEnergyAcc", "maxEnergyAcc")])
    if (d := find("MarkerDesc")) is not None:
        w["isMarker"] = True
        _copy(w, d, [("markerPointDefaultHeight", "markerPointDefaultHeight"),
                     ("markerPointDefaultRadius", "markerPointDefaultRadius")], f32)
    if (d := find("EjectorDesc")) is not None:
        w["isEjector"] = True
        _copy(w, d, [("ejectorChargeFrame", "chargeFrame"), ("ejectorColdFrame", "coldFrame"),
                     ("ejectorBulletId", "bulletProtoId")])
    if (d := find("SiloDesc")) is not None:
        w["isSilo"] = True
        _copy(w, d, [("siloChargeFrame", "chargeFrame"), ("siloColdFrame", "coldFrame"),
                     ("siloBulletId", "bulletProtoId")])
    anim = find("AnimDesc")
    w["anim_prepare_length"] = f32(anim.get("prepare_length", 0.0)) if anim is not None else 0.0
    w["anim_working_length"] = f32(anim.get("working_length", 1.0)) if anim is not None else 1.0
    if (d := find("PowerDesc")) is not None:
        _copy(w, d, [("isPowerNode", "node"), ("isPowerGen", "generator"), ("photovoltaic", "photovoltaic"),
                     ("windForcedPower", "wind"), ("gammaRayReceiver", "gamma"), ("geothermal", "geothermal"),
                     ("isAccumulator", "accumulator"), ("isPowerConsumer", "consumer"),
                     ("isPowerCharger", "charger"), ("isPowerExchanger", "exchanger")], bool)
        _copy(w, d, [("powerConnectDistance", "connectDistance"), ("powerCoverRadius", "coverRadius")], f32)
        _copy(w, d, [("genEnergyPerTick", "genEnergyPerTick"), ("useFuelPerTick", "useFuelPerTick"),
                     ("fuelMask", "fuelMask"), ("powerCatalystId", "catalystId"),
                     ("powerProductId", "productId"), ("powerProductHeat", "productHeat"),
                     ("inputEnergyPerTick", "inputEnergyPerTick"), ("outputEnergyPerTick", "outputEnergyPerTick"),
                     ("maxAcuEnergy", "maxAcuEnergy"), ("workEnergyPerTick", "workEnergyPerTick"),
                     ("idleEnergyPerTick", "idleEnergyPerTick"), ("exchangeEnergyPerTick", "exchangeEnergyPerTick"),
                     ("emptyId", "emptyId"), ("fullId", "fullId")])
    return w


def building_entry(model, root):
    """Metadata for one model, or None when its prefab has no SlotConfig."""
    slot = find_script(root, "SlotConfig")
    if slot is None:
        return None
    mid = model["ID"]

    def poses(key):
        out = []
        for i, p in enumerate(slot.get(key) or []):
            if p.get("m_FileID", 0) != 0 or not p.get("m_PathID"):
                raise ExtractError(f"model {mid}: SlotConfig.{key}[{i}] does not point at a Transform in its prefab")
            try:
                pos, rot = pose_relative_to_root(root, p["m_PathID"])
            except ExtractError as e:
                raise ExtractError(f"model {mid}: SlotConfig.{key}[{i}]: {e}") from None
            out.append({"pos": pos, "rot": rot})
        return out

    return {
        "modelIndex": mid,
        "prefab": model.get("PrefabPath"),
        "selectSize": _vec(slot["selectSize"]),
        "selectCenter": _vec(slot["selectCenter"]),
        "slotPoses": poses("slotPoses"),
        "insertPoses": poses("insertPoses"),
        "tint": main_tint(root),
        "work": work_params(lambda s: find_script(root, s)),
    }
