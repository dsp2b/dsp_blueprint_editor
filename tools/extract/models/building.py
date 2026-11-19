"""Static building models (LODModelDesc.lodMeshDatas) -> GLB."""
import numpy as np

from ..errors import ExtractError
from . import textures
from .glb import GlbBuilder


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _color_key(col):
    return tuple(round(float(c), 3) for c in col)


def build_building_glb(asset):
    """asset: gamedata.MeshAsset of one LOD -> (glb bytes, info)."""
    m = asset.mesh
    g = GlbBuilder()
    attrs = g.vertices(m["pos"], m["nrm"], m["uv"])
    prims, notes, textured, tris = [], [], False, 0
    for si, idx in enumerate(m["subs"]):
        mat = asset.materials[si] if si < len(asset.materials) else None
        shader = mat.shader if mat else "?"
        if mat and is_effect_shader(shader):
            notes.append(f"skipped effect submesh {si} ({mat.name}, {shader})")
            continue
        n = len(idx) // 3
        tris += n
        pbr = {"metallicFactor": 0.0, "roughnessFactor": 0.7}
        gm = {"name": mat.name if mat else f"sub{si}", "pbrMetallicRoughness": pbr}
        if mat:
            col = mat.colors.get("_Color", (1, 1, 1, 1))
            base = [srgb_to_linear(col[0]), srgb_to_linear(col[1]), srgb_to_linear(col[2]), col[3]]
            main = mat.textures.get("_MainTex")
            if "Black Mask" in shader:
                base, main = [0.02, 0.02, 0.02, 1], None
            if main is not None:
                pbr["baseColorTexture"] = {"index": g.jpeg(("albedo", main.key, _color_key(col)), textures.tinted(main.image, col))}
                textured = True
                base = [1.0, 1.0, 1.0, 1.0]
            pbr["baseColorFactor"] = base
            if "Glass" in shader:
                gm["alphaMode"] = "BLEND"
                pbr["baseColorFactor"] = [0.6, 0.8, 1.0, 0.35]
            emission = mat.textures.get("_EmissionTex")
            if emission is not None:
                gm["emissiveTexture"] = {"index": g.jpeg(("emission", emission.key), emission.image)}
                gm["emissiveFactor"] = [1.0, 1.0, 1.0]
        prims.append(g.primitive(attrs, idx, g.material(gm)))
    if not prims:
        raise ExtractError(f"model mesh {asset.name} has no renderable submesh")
    mesh = g.mesh(asset.name, prims)
    g.node(asset.name, mesh)
    data = g.to_bytes()
    pos = np.asarray(m["pos"])
    return data, {"triangles": int(tris), "bytes": len(data), "textured": textured, "notes": notes,
                  "unityBBoxMin": [round(float(x), 3) for x in pos.min(axis=0)],
                  "unityBBoxMax": [round(float(x), 3) for x in pos.max(axis=0)]}


def is_effect_shader(shader):
    return "Additive" in shader or "Unlit" in shader
