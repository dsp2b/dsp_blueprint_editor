"""Orchestrates the GLB export: which models, which LODs, the manifest, and landing into raw/<version>/."""
import hashlib
import json
import os
import shutil

from ..coverage import NO_STATIC_MODEL
from ..errors import ExtractError
from ..jsonout import dump_json
from . import belt as belt_mod
from . import sorter as sorter_mod
from .building import build_building_glb, is_effect_shader
from .coords import CONVENTION

EXTRA_NOTES = {
    41: "sorter body is stretched at runtime by the Inserter shader between _PosA/_PosB; static mesh is the default ~1.9 m length",
    44: "mesh extends 1.5 m below ground (foundation)",
    50: "single LOD only; top ship ring makes bbox ~28 m wide vs selectSize 8 m",
}
BUILDING_SLOTS = ("_MainTex", "_EmissionTex")


def chosen_lods(count):
    """[(tag, lod index)]: the lowest LOD, plus LOD0 when the model has more than one."""
    if count == 0:
        return []
    return [("lowest", count - 1)] + ([("lod0", 0)] if count > 1 else [])


def _refs(material, slots):
    return [material.textures[s] for s in slots if s in material.textures]


def _round(values):
    return [round(float(v), 4) for v in values] if values is not None else None


def export_models(game, models, log=lambda msg: None):
    """models: buildings.json `models` entries. Returns {path relative to raw/<ver>/: bytes}, including
    models/manifest.json. `game` provides prepare / building / belt / sorter / load_textures (GameModels)."""
    static = [m for m in sorted(models, key=lambda m: m["modelIndex"]) if m["modelIndex"] not in NO_STATIC_MODEL]
    game.prepare([m["prefab"] for m in static])
    sources, missing = {}, []
    for m in static:
        src = game.building(m["prefab"])
        if src is None or not src.lods:
            missing.append(f"{m['modelIndex']} ({m['prefab']})")
        else:
            sources[m["modelIndex"]] = src
    if missing:
        raise ExtractError("building model(s) without a LODModelDesc mesh: " + ", ".join(missing))
    belt_src = game.belt()
    sorter_assets = {(t, lod): game.sorter(t, lod) for t in sorter_mod.SORTER_TIERS for lod in sorter_mod.SORTER_LODS}

    refs = []
    for src in sources.values():
        for _, li in chosen_lods(len(src.lods)):
            for mat in src.lods[li].materials:
                if not is_effect_shader(mat.shader):
                    refs += _refs(mat, BUILDING_SLOTS)
    for mat in [*belt_src.tiers.values(), belt_src.head_material]:
        refs += _refs(mat, ("_MainTex", "_ClipTex", "_EmissionTex"))
    for asset in sorter_assets.values():
        refs += [mat.textures["_MainTex"] for mat in asset.materials if "_MainTex" in mat.textures]
    game.load_textures(refs)

    files, buildings = {}, {}
    for m in static:
        mi, src = m["modelIndex"], sources[m["modelIndex"]]
        entry = None
        for tag, li in chosen_lods(len(src.lods)):
            data, info = build_building_glb(src.lods[li])
            fn = f"{mi}.glb" if tag == "lowest" else f"{mi}.lod0.glb"
            files[f"models/{fn}"] = data
            e = {"file": fn, "bytes": info["bytes"], "triangles": info["triangles"], "lod": li, "textured": info["textured"]}
            if tag == "lowest":
                lod_tris = [int(sum(len(s) for s in lod.mesh["subs"]) // 3) for lod in src.lods]
                notes = info["notes"] + ([EXTRA_NOTES[mi]] if mi in EXTRA_NOTES else []) + [CONVENTION]
                entry = {**e, "lodTriangles": lod_tris, "lodDistances": src.distances, "selectSize": _round(m["selectSize"]),
                         "selectCenter": _round(m["selectCenter"]), "unityBBoxMin": info["unityBBoxMin"],
                         "unityBBoxMax": info["unityBBoxMax"], "prefab": src.prefab, "notes": "; ".join(notes)}
            else:
                entry["lod0"] = e
        buildings[str(mi)] = entry
    log(f"{len(buildings)} building models")

    belts = {}
    for tier, (data, info) in belt_mod.build_belt_glbs(belt_src).items():
        fn = f"belt/belt-mk{tier}.glb"
        files[f"models/{fn}"] = data
        belts[f"mk{tier}"] = {"file": fn, **info}
    sorters = {}
    for tier in sorter_mod.SORTER_TIERS:
        for lod in sorter_mod.SORTER_LODS:
            name = f"sorter-mk{tier}" + ("-lod2" if lod == 2 else "")
            data, info = sorter_mod.build_sorter_glb(tier, lod, sorter_assets[(tier, lod)])
            files[f"models/sorter/{name}.glb"] = data
            sorters[name] = {"file": f"sorter/{name}.glb", **info}
    files["models/manifest.json"] = dump_json({"convention": CONVENTION, "buildings": buildings, "belts": belts, "sorters": sorters})
    return files


def merge_raw_manifest(raw_manifest, files):
    """raw/<ver>/manifest.json bytes -> same manifest whose `files` lists exactly `files` under models/
    (earlier models/ entries are dropped first, so re-running never leaves stale ones)."""
    manifest = json.loads(raw_manifest)
    kept = {k: v for k, v in manifest["files"].items() if not k.startswith("models/")}
    kept.update({k: {"size": len(v), "sha256": hashlib.sha256(v).hexdigest()} for k, v in files.items()})
    manifest["files"] = dict(sorted(kept.items()))
    return dump_json(manifest)


def write_models(raw_dir, files, stage=None):
    """Replace raw_dir/models/ with `files` and update raw_dir/manifest.json; a failure leaves both as they were.
    `stage` (optional) is called with the staged directory before anything is replaced (validation)."""
    manifest_path = raw_dir / "manifest.json"
    if not manifest_path.is_file():
        raise ExtractError(f"{manifest_path} not found; run the raw extraction first")
    new_manifest = merge_raw_manifest(manifest_path.read_bytes(), files)
    staging, old = raw_dir / f".models.partial-{os.getpid()}", raw_dir / f".models.old-{os.getpid()}"
    target = raw_dir / "models"
    shutil.rmtree(staging, ignore_errors=True)
    try:
        for rel, data in files.items():
            p = staging / rel[len("models/"):]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        if stage is not None:
            stage(staging)
        if target.exists():
            target.rename(old)
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if old.exists() and not target.exists():
            old.rename(target)
        raise
    shutil.rmtree(old, ignore_errors=True)
    tmp = raw_dir / f".manifest.json.partial-{os.getpid()}"
    tmp.write_bytes(new_manifest)
    os.replace(tmp, manifest_path)
    return target
