"""Sorter (inserter) parts per tier and LOD -> GLB.

The game draws a sorter from one mesh whose vertices carry a frame code in their colour; the Inserter
Body vertex shader moves each part to its end frame. The GLB splits the mesh by part, places each node
at the default pose and tags it with an `extras.frame`; the two pieces that stretch between the ends
(top beam and arrow) keep their vertices baked at the default pose with a custom `_FRAME` attribute
(0 = ATop, 1 = BTop) so the renderer can re-pose them."""
import numpy as np

from . import textures
from .glb import GlbBuilder

SORTER_TIERS = (1, 2, 3, 4)
SORTER_LODS = (0, 2)

VISIBILITY = {"ARail": "only if pick end is on a building (t1=1)", "BRail": "only if insert end is on a building (t2=1)",
              "ATopRail": "only if t1=1", "BTopRail": "only if t2=1", "grabberLoaded": "only while carrying an item"}


def part_of(code):
    """Inserter Body VS (_ENABLE_VFINST) frame selection from vertex COLOR*255 = (xc, yc, zc)."""
    xc, yc, zc = code
    if zc == 1:
        return "grabber"
    if zc == 2:
        return "grabberLoaded"          # shown only while carrying an item
    rail = xc >= 2
    end = "A" if xc % 2 == 1 else "B"
    if yc == 1:
        return f"{end}Top" + ("Rail" if rail else "")
    return end + ("Rail" if rail else "Cap")


def default_frames(length=2.0, t1=1, t2=1, s=0.5):
    """Default pose: A (pick end) at the origin, B (insert end) `length` m along +Z, both on buildings,
    grabber half way along the arc A -> ATop -> BTop -> B."""
    a, b = np.array([0, 0, 0.]), np.array([0, 0, length])
    up, fw = np.array([0, 1, 0.]), np.array([0, 0, 1.])
    a_top, b_top = a + up + fw * 1.03 * t1, b + up - fw * 1.03 * t2
    pts = [a + up, a_top, b_top, b + up]
    seg = [np.linalg.norm(pts[i + 1] - pts[i]) for i in range(3)]
    d = s * sum(seg)
    for i in range(3):
        if d <= seg[i] or i == 2:
            grab = pts[i] + (pts[i + 1] - pts[i]) * (d / seg[i] if seg[i] else 0)
            break
        d -= seg[i]
    return {"A": a, "ACap": a, "ARail": a, "B": b, "BCap": b, "BRail": b, "ATop": a_top, "ATopRail": a_top,
            "BTop": b_top, "BTopRail": b_top, "grabber": grab, "grabberLoaded": grab}


def _compact(P, N, UV, tri_idx):
    """keep only the vertices used by tri_idx, reindexed."""
    used = np.unique(tri_idx)
    remap = -np.ones(len(P), np.int64)
    remap[used] = np.arange(len(used))
    return P[used], N[used] if N is not None else None, UV[used] if UV is not None else None, remap[tri_idx], used


def build_sorter_glb(tier, lod, asset):
    """asset: gamedata.MeshAsset (inserter-<tier>[-lod<n>] mesh data; materials [body, arrow]) -> (bytes, info)"""
    m = asset.mesh
    P, N, UV = np.asarray(m["pos"], np.float32), m["nrm"], m["uv"]
    codes = np.round(np.asarray(m["col"])[:, :3] * 255).astype(int)
    body, arrow = asset.materials[0], asset.materials[1]
    b = GlbBuilder()
    body_col = body.colors["_Color"]
    mb = b.material({"name": body.name, "pbrMetallicRoughness": {
        "baseColorTexture": {"index": b.jpeg(("sorter-body", tier, lod), textures.tinted(body.textures["_MainTex"].image, body_col))},
        "metallicFactor": 0.0, "roughnessFactor": 0.6}})
    tint, off_power = arrow.colors["_TintColor"], arrow.colors["_OffPowerColor"]
    arrow_speed = arrow.floats["_ArrowSpeed"]
    arrow_img = arrow.textures["_MainTex"].image.convert("RGBA")
    ma = b.material({"name": arrow.name, "alphaMode": "BLEND", "doubleSided": True, "extensions": {"KHR_materials_unlit": {}},
                     "pbrMetallicRoughness": {"baseColorTexture": {"index": b.png(("sorter-arrow", tier, lod), arrow_img)},
                                              "baseColorFactor": [*tint[:3], min(1.0, arrow.floats["_AlphaMultiplier"])]},
                     "extras": {"arrowSpeed": arrow_speed, "offPowerColor": list(off_power),
                                "uv": "v tiles along by (|ATop-BTop|+1) metres; scroll v by 2*animPhase"}})
    b.use_extension("KHR_materials_unlit")
    frames = default_frames()

    tri = np.asarray(m["subs"][0], np.int64).reshape(-1, 3)
    vpart = np.array([part_of(tuple(c)) for c in codes])
    tp = vpart[tri]
    uniform = (tp[:, 0] == tp[:, 1]) & (tp[:, 0] == tp[:, 2])
    beam = tri[~uniform]                    # thin top beam whose ends follow ATop / BTop
    tri, tp = tri[uniform], tp[uniform]
    counts = {}
    for part in sorted(str(x) for x in np.unique(tp[:, 0])):
        p, n, uv, t, _ = _compact(P, N, UV, tri[tp[:, 0] == part].reshape(-1))
        mesh = b.mesh(part, [b.primitive(b.vertices(p, n, uv), t, mb)])
        counts[part] = len(t) // 3
        extras = {"frame": part.replace("Cap", "").replace("Rail", "").replace("Loaded", "")}
        if part in VISIBILITY:
            extras["visible"] = VISIBILITY[part]
        b.node(part, mesh, translation=tuple(frames[part]), extras=extras)

    def stretched(name, idx, material, note):
        idx = np.asarray(idx).reshape(-1)
        if len(idx) == 0:
            return
        p, n, uv, t, used = _compact(P, N, UV, idx)
        at_a = codes[used, 0] % 2 == 1
        p = p.copy()
        p[at_a] += frames["ATop"]
        p[~at_a] += frames["BTop"]
        attrs = b.vertices(p, n, uv, custom={"_FRAME": (~at_a).astype("<f4")})
        counts[name] = len(t) // 3
        b.node(name, b.mesh(name, [b.primitive(attrs, t, material)]), extras={"note": note})

    stretched("topBeam", beam, mb, "thin beam between ATop and BTop; vertex local coords = baked pos - frame pos")
    stretched("arrow", m["subs"][1], ma, "quad from ATop-0.5*fwdA to BTop+0.5*fwdB at top height")
    data = b.to_bytes()
    return data, {"bytes": len(data), "lod": lod, "triangles": counts, "total": int(sum(counts.values())),
                  "bodyColor": [round(float(x), 3) for x in body_col], "arrowTint": [round(float(x), 3) for x in tint],
                  "arrowSpeed": arrow_speed,
                  "defaultPose": "A=(0,0,0) B=(0,0,2) t1=t2=1 grabber s=0.5 (glTF coords, +Z = A->B)"}
