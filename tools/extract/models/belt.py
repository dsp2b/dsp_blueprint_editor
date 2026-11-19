"""Belt segment and path end caps per tier -> GLB.

The game draws belts with a shader sweep (BeltRenderingBatch + Belt Instancing shader, with
Configs.builtin.beltMesh), so there is no static whole model. This reproduces the vertex shader on a
straight 1 m piece along +Z and adds the two path end caps (Path Model Instancing shader)."""
from dataclasses import dataclass

import numpy as np

from . import textures
from .glb import GlbBuilder

TIERS = (1, 2, 3)
BOTTOM_WIDEN = 1.13          # shader widens the underside
SEGMENT_PATH_POINTS = 17 * 0.06   # shader o4.x = t/17, one path point ~0.06 m
SCROLL_REPEATS_PER_UVSPEED = 3.529412
HEAD_OFFSETS = {"head-short": 1.6, "head-long": 2.6}


@dataclass
class BeltSource:
    segment: dict      # {"P","N","UV","T"}: belt-seg-0 mesh, Unity space
    heads: dict        # {"head-short": (P,N,UV,T), "head-long": (...)}
    head_material: object   # Material belt-head-0 (colors _Color1..3, _MainTex)
    tiers: dict        # {1|2|3: Material belt-inst-s<tier>-0 (_MainTex,_ClipTex,_EmissionTex; _Color,_EmissionColor,_UVSpeed)}


def _r(values):
    return [round(float(x), 3) for x in values]


def _segment_geometry(seg):
    P0, N0 = np.asarray(seg["P"], np.float32), np.asarray(seg["N"], np.float32)
    P = P0.copy()
    P[P[:, 1] + 0.05 < 0, 0] *= BOTTOM_WIDEN
    n = N0 + np.array([0, 0.25, 0], np.float32)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    cross = 1 - (P0[:, 0] + 0.5 - n[:, 0] * P0[:, 1] * 0.666666)        # shader o4.y
    along = P0[:, 2] / SEGMENT_PATH_POINTS                                # shader o4.x
    uv0 = np.stack([along, cross], 1)
    uv1 = np.stack([P0[:, 2], cross], 1)                                  # emission uses instance-local z
    return P, n, uv0, uv1


def build_belt_glbs(src):
    """-> {tier: (glb bytes, info)}"""
    out = {}
    seg_p, seg_n, uv0, uv1 = _segment_geometry(src.segment)
    for tier in TIERS:
        mat = src.tiers[tier]
        col, fl = mat.colors["_Color"], mat.floats["_UVSpeed"]
        b = GlbBuilder()
        albedo = textures.masked_tint(mat.textures["_MainTex"].image, mat.textures["_ClipTex"].image, col)
        emission = textures.scaled(mat.textures["_EmissionTex"].image, mat.colors["_EmissionColor"])
        mi = b.material({"name": f"belt-mk{tier}", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": b.jpeg(("belt-albedo", tier), albedo)}, "metallicFactor": 0.0, "roughnessFactor": 0.6},
            "emissiveTexture": {"index": b.jpeg(("belt-emission", tier), emission), "texCoord": 1}, "emissiveFactor": [1, 1, 1],
            "extras": {"uvSpeed": fl, "scrollTexRepeatsPerSecond": fl * SCROLL_REPEATS_PER_UVSPEED,
                       "metersPerTexRepeat": 1.02, "scrollAxis": "TEXCOORD_0.x, only where |TEXCOORD_0.y-0.5|<0.34",
                       "scrollSign": "u_sample = u - frac(scrollTexRepeatsPerSecond*time)"}})
        seg_mesh = b.mesh("belt-segment-1m", [b.primitive(b.vertices(seg_p, seg_n, uv0, uv1), src.segment["T"], mi)])
        b.node("segment", seg_mesh, extras={"note": "straight 1 m piece along +Z; top at y=0 = belt path height (entity pos + 0.15 radial)"})
        tris = {"segment": len(src.segment["T"]) // 3}

        head_col = src.head_material.colors[f"_Color{tier}"]
        head_img = textures.tinted(src.head_material.textures["_MainTex"].image, head_col)
        hm = b.material({"name": f"belt-head-mk{tier}", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": b.jpeg(("belt-head", tier), head_img)}, "metallicFactor": 0.0, "roughnessFactor": 0.6}})
        for name, (hp, hn, huv, ht) in src.heads.items():
            hp = np.array(hp, np.float32)
            bottom = hp[:, 1] + 0.05 < 0
            hp[bottom, 0] *= BOTTOM_WIDEN
            hp[bottom, 2] *= BOTTOM_WIDEN
            mesh = b.mesh(name, [b.primitive(b.vertices(hp, hn, huv), ht, hm)])
            b.node(name, mesh, translation=(HEAD_OFFSETS[name], 0, 0),
                   extras={"note": "placed at path point pos/rot; start cap uses rot*Euler(0,180,0)"})
            tris[name] = len(ht) // 3
        data = b.to_bytes()
        out[tier] = (data, {"bytes": len(data), "triangles": tris, "color": _r(col), "emissionColor": _r(mat.colors["_EmissionColor"]),
                            "uvSpeed": fl, "headColor": _r(head_col)})
    return out
