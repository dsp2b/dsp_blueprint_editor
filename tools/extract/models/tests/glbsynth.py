"""Synthetic meshes, materials and a GLB reader shared by the models tests (no game files needed)."""
import json
import struct

import numpy as np
from PIL import Image

from tools.extract.models.gamedata import Material, MeshAsset, TexRef


def tex(rgba, size=8):
    return TexRef.of(Image.new("RGBA", (size, size), rgba))


def pyramid():
    """Unity-space pyramid: base on y=0, apex at +x so the X mirror is observable. Outward CCW winding
    as seen from outside in a left-handed system is not needed: the tests only check the transform."""
    pos = np.array([[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2], [1, 1, 1]], np.float32)
    nrm = np.array([[0, -1, 0]] * 4 + [[1, 1, 0]], np.float32)
    uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.25]], np.float32)
    subs = [np.array([0, 1, 2, 0, 2, 3], np.int32), np.array([0, 4, 1, 1, 4, 2], np.int32)]
    return {"pos": pos, "nrm": nrm, "uv": uv, "subs": subs}


def material(name="m", shader="DSP/PBR", color=(0.5, 0.25, 1.0, 1.0), albedo=(200, 200, 200, 255), emission=None):
    textures = {"_MainTex": tex(albedo)}
    if emission:
        textures["_EmissionTex"] = tex(emission)
    return Material(name, shader, {"_Color": color}, {}, textures)


def building_asset(name="lod0", mats=None):
    return MeshAsset(name, pyramid(), mats or [material("a"), material("b", color=(1, 1, 1, 1))])


def read_glb(data):
    """-> (json dict, bin bytes)"""
    magic, version, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2 and total == len(data)
    jl, jt = struct.unpack_from("<II", data, 12)
    assert jt == 0x4E4F534A
    g = json.loads(data[20:20 + jl])
    bl, bt = struct.unpack_from("<II", data, 20 + jl)
    assert bt == 0x004E4942
    return g, data[28 + jl:28 + jl + bl]


def accessor(g, binc, i):
    a = g["accessors"][i]
    bv = g["bufferViews"][a["bufferView"]]
    dt = {5126: "<f4", 5123: "<u2", 5125: "<u4"}[a["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
    arr = np.frombuffer(binc, dtype=dt, count=a["count"] * n, offset=bv["byteOffset"])
    return arr.reshape(a["count"], n) if n > 1 else arr


def belt_source():
    from tools.extract.models.belt import BeltSource
    # a 1 m trough along +Z: top ring at y=0, bottom ring below (widened by the shader port)
    P = np.array([[-.5, 0, 0], [.5, 0, 0], [.4, -.2, 0], [-.4, -.2, 0],
                  [-.5, 0, 1], [.5, 0, 1], [.4, -.2, 1], [-.4, -.2, 1]], np.float32)
    N = np.array([[0, 1, 0]] * 4 + [[0, 1, 0]] * 4, np.float32)
    UV = np.array([[0, 0], [1, 0], [1, 1], [0, 1]] * 2, np.float32)
    T = np.array([0, 1, 5, 0, 5, 4, 3, 2, 6, 3, 6, 7], np.int32)
    head = (P[:4].copy(), N[:4].copy(), UV[:4].copy(), np.array([0, 1, 2, 0, 2, 3], np.int32))
    long_head = (P[:4] * 2, N[:4].copy(), UV[:4].copy(), np.array([0, 1, 2, 0, 2, 3], np.int32))
    tiers = {}
    for tier, col in ((1, (0.2, 0.5, 1, 1)), (2, (0.9, 0.5, 0.1, 1)), (3, (0.4, 1, 0.4, 1))):
        tiers[tier] = Material(f"belt-inst-s{tier}-0", "DSP/Belt Instancing", {"_Color": col, "_EmissionColor": (1, 0.8, 0.6, 1)},
                               {"_UVSpeed": 0.5 * tier}, {"_MainTex": tex((120, 120, 120, 255)), "_ClipTex": tex((0, 0, 255, 255)),
                                                         "_EmissionTex": tex((10, 200, 30, 255))})
    head_mat = Material("belt-head-0", "DSP/Path", {"_Color1": (1, 0, 0, 1), "_Color2": (0, 1, 0, 1), "_Color3": (0, 0, 1, 1)}, {},
                        {"_MainTex": tex((100, 100, 100, 255))})
    return BeltSource({"P": P, "N": N, "UV": UV, "T": T}, {"head-short": head, "head-long": long_head}, head_mat, tiers)


# vertex colour codes (xc, yc, zc) of the inserter parts, see sorter.part_of
SORTER_CODES = {"ACap": (1, 0, 0), "ARail": (3, 0, 0), "BCap": (0, 0, 0), "BRail": (2, 0, 0),
                "ATop": (1, 1, 0), "BTop": (0, 1, 0), "grabber": (0, 0, 1), "grabberLoaded": (0, 0, 2)}


def sorter_asset(tier=1):
    pos, col, tris = [], [], []

    def tri(codes, base):
        for k, c in enumerate(codes):
            pos.append([base[0] + (0.1 if k == 1 else 0), base[1] + (0.1 if k == 2 else 0), base[2]])
            col.append([c[0] / 255, c[1] / 255, c[2] / 255, 1])
        n = len(pos)
        tris.extend([n - 3, n - 2, n - 1])

    for i, code in enumerate(SORTER_CODES.values()):
        tri([code] * 3, (0.0, 0.0, 0.2 * i))
    tri([SORTER_CODES["ATop"], SORTER_CODES["BTop"], SORTER_CODES["BTop"]], (0, 0, 3))  # beam: ends follow different frames
    arrow_first = len(pos)
    quad_codes = [SORTER_CODES["ATop"], SORTER_CODES["ATop"], SORTER_CODES["BTop"], SORTER_CODES["BTop"]]
    for k, c in enumerate(quad_codes):
        pos.append([(-0.2, 0.2, 0.2, -0.2)[k], 0.0, (-0.5, -0.5, 0.5, 0.5)[k]])
        col.append([c[0] / 255, c[1] / 255, c[2] / 255, 1])
    arrow = [arrow_first + i for i in (0, 1, 2, 0, 2, 3)]
    pos = np.array(pos, np.float32)
    mesh = {"pos": pos, "nrm": np.tile(np.array([[0, 1, 0]], np.float32), (len(pos), 1)),
            "col": np.array(col, np.float32), "uv": np.zeros((len(pos), 2), np.float32),
            "subs": [np.array(tris, np.int32), np.array(arrow, np.int32)]}
    body = Material(f"inserter-{tier}", "DSP/Inserter Body", {"_Color": (0.3, 0.6, 0.9, 1)}, {}, {"_MainTex": tex((90, 90, 90, 255))})
    arrow_m = Material("inserter-arrow", "DSP/Inserter Arrow", {"_TintColor": (1, 1, 0.5, 1), "_OffPowerColor": (0.3, 0.3, 0.3, 1)},
                       {"_ArrowSpeed": 1.5, "_AlphaMultiplier": 0.8}, {"_MainTex": tex((255, 255, 255, 128))})
    return MeshAsset(f"inserter-{tier}", mesh, [body, arrow_m])
