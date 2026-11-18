import io
import struct

import numpy as np
import pytest
from PIL import Image

from tools.extract.models import coords, textures, meshdata
from tools.extract.models.building import build_building_glb
from tools.extract.models.validation import validate_glbs

from glbsynth import accessor, building_asset, pyramid, read_glb


# ---------------------------------------------------------------- coordinates

def test_positions_are_x_mirrored_and_input_untouched():
    p = np.array([[1, 2, 3], [-4, 5, 6]], np.float32)
    out = coords.mirror_x(p)
    assert out.tolist() == [[-1, 2, 3], [4, 5, 6]]
    assert p[0, 0] == 1


def test_winding_is_reversed_and_uv_v_flipped():
    assert coords.reverse_winding(np.array([0, 1, 2, 3, 4, 5])).tolist() == [0, 2, 1, 3, 5, 4]
    assert coords.flip_v(np.array([[0.25, 0.1]], np.float32)).tolist() == [[0.25, pytest.approx(0.9)]]


def test_mirrored_mesh_keeps_faces_pointing_along_their_normals():
    """Unity is left-handed (clockwise front faces); after mirror + reversed winding the right-handed
    counter-clockwise face normal must still agree with the (mirrored) vertex normals."""
    P = np.array([[0, 0, 0], [0, 1, 0], [1, 0, 0]], np.float32)  # clockwise seen from -z in LH => faces -z
    N = np.array([[0, 0, -1]] * 3, np.float32)
    p, n, t = coords.mirror_x(P), coords.mirror_x(N), coords.reverse_winding(np.array([0, 1, 2])).reshape(-1, 3)
    face = np.cross(p[t[0, 1]] - p[t[0, 0]], p[t[0, 2]] - p[t[0, 0]])
    assert float(face @ n[0]) > 0
    # without the winding fix it would face away
    bad = np.cross(p[1] - p[0], p[2] - p[0])
    assert float(bad @ n[0]) < 0


def test_translation_and_rotation_mirror():
    assert coords.mirror_translation((1, 2, 3)) == [-1, 2, 3]
    assert coords.mirror_quat((0.1, 0.2, 0.3, 0.9)) == [0.1, -0.2, -0.3, 0.9]


# ---------------------------------------------------------------- glb writing

def test_building_glb_uses_mirrored_positions_and_reversed_winding():
    data, info = build_building_glb(building_asset())
    g, binc = read_glb(data)
    attrs = g["meshes"][0]["primitives"][0]["attributes"]
    pos = accessor(g, binc, attrs["POSITION"])
    assert pos[:, 0].tolist() == (-pyramid()["pos"][:, 0]).tolist()
    idx = accessor(g, binc, g["meshes"][0]["primitives"][0]["indices"])
    assert idx.tolist() == [0, 2, 1, 0, 3, 2]
    uv = accessor(g, binc, attrs["TEXCOORD_0"])
    assert uv[1].tolist() == [1.0, 1.0]  # v: 0 -> 1
    nrm = accessor(g, binc, attrs["NORMAL"])
    assert nrm[4, 0] < 0 and np.allclose(np.linalg.norm(nrm, axis=1), 1, atol=1e-5)
    assert info["triangles"] == 4 and info["bytes"] == len(data)


def test_glb_bytes_are_deterministic():
    a, _ = build_building_glb(building_asset())
    b, _ = build_building_glb(building_asset())
    assert a == b


def test_glb_layout_is_valid_and_json_is_four_byte_aligned():
    data, _ = build_building_glb(building_asset())
    g, binc = read_glb(data)
    assert len(data) % 4 == 0 and g["asset"]["version"] == "2.0"
    assert g["buffers"][0]["byteLength"] == len(binc)


def test_every_synthetic_glb_passes_khronos_validator_without_warnings(tmp_path):
    data, _ = build_building_glb(building_asset())
    p = tmp_path / "b.glb"
    p.write_bytes(data)
    (r,) = validate_glbs([p])
    assert (r["errors"], r["warnings"], r["messages"]) == (0, 0, [])


def test_validator_reports_a_broken_glb(tmp_path):
    data, _ = build_building_glb(building_asset())
    p = tmp_path / "bad.glb"
    p.write_bytes(b"glTX" + data[4:])
    (r,) = validate_glbs([p])
    assert r["errors"] > 0


# ---------------------------------------------------------------- textures

def test_tint_blends_color_through_alpha_mask():
    img = Image.new("RGBA", (2, 1))
    img.putpixel((0, 0), (128, 128, 128, 255))  # fully masked: tinted
    img.putpixel((1, 0), (128, 128, 128, 0))    # unmasked: untouched
    out = textures.tinted(img, (1.0, 0.5, 0.0, 1.0))
    assert out.mode == "RGB"
    assert out.getpixel((0, 0)) == (128, 64, 0)
    assert out.getpixel((1, 0)) == (128, 128, 128)


def test_fit_caps_longest_side_at_512_and_keeps_small_images():
    assert textures.fit(Image.new("RGB", (2048, 1024))).size == (512, 256)
    assert textures.fit(Image.new("RGB", (64, 64))).size == (64, 64)


def test_jpeg_encoding_is_stable_and_capped():
    img = Image.effect_noise((1024, 1024), 40).convert("RGB")
    a = textures.jpeg_bytes(img)
    assert a == textures.jpeg_bytes(img)
    out = Image.open(io.BytesIO(a))
    assert out.format == "JPEG" and max(out.size) <= 512


# ---------------------------------------------------------------- MeshData parsing

def encode_mesh(vc, subs, *, normals=True, uv=True, tangents=False, colors=False, uv2=False):
    rng = np.random.default_rng(1)
    out = struct.pack("<iii", vc, 0, len(subs)) + b"\0" * (4 * len(subs))
    out += struct.pack("<7?", normals, tangents, colors, uv, uv2, False, False)
    parts = {"pos": rng.random((vc, 3), dtype=np.float32)}
    out += parts["pos"].tobytes()
    if normals:
        parts["nrm"] = rng.random((vc, 3), dtype=np.float32); out += parts["nrm"].tobytes()
    if tangents:
        out += rng.random((vc, 4), dtype=np.float32).tobytes()
    if colors:
        parts["col"] = rng.random((vc, 4), dtype=np.float32); out += parts["col"].tobytes()
    if uv:
        parts["uv"] = rng.random((vc, 2), dtype=np.float32); out += parts["uv"].tobytes()
    if uv2:
        out += rng.random((vc, 2), dtype=np.float32).tobytes()
    for s in subs:
        out += struct.pack("<i", len(s)) + np.asarray(s, "<i4").tobytes()
    return out, parts


def test_mesh_data_parse_roundtrip_with_optional_streams():
    subs = [[0, 1, 2], [2, 1, 3, 3, 1, 0]]
    raw, parts = encode_mesh(4, subs, tangents=True, colors=True, uv2=True)
    m = meshdata.parse_mesh_data(raw)
    assert np.array_equal(m["pos"], parts["pos"]) and np.array_equal(m["uv"], parts["uv"])
    assert np.array_equal(m["col"], parts["col"])
    assert [s.tolist() for s in m["subs"]] == subs


def test_mesh_data_without_normals_or_uv_and_trailing_garbage_rejected():
    raw, _ = encode_mesh(3, [[0, 1, 2]], normals=False, uv=False)
    m = meshdata.parse_mesh_data(raw)
    assert m["nrm"] is None and m["uv"] is None
    with pytest.raises(ValueError):
        meshdata.parse_mesh_data(raw + b"\0\0\0\0")


def test_lod_desc_parse():
    name = b"LOD"
    raw = b"\0" * 28 + struct.pack("<i", len(name)) + name + b"\0"  # name padded to 4
    raw += struct.pack("<i", 2) + struct.pack("<iq", 1, 10) + struct.pack("<iq", 1, 11)
    raw += struct.pack("<i", 2) + struct.pack("<ff", 125.0, 5000.0)
    ptrs, dist = meshdata.parse_lod_desc(raw)
    assert ptrs == [(1, 10), (1, 11)] and dist == [125.0, 5000.0]


def test_mesh_with_only_effect_submeshes_is_rejected():
    from glbsynth import material
    from tools.extract.errors import ExtractError
    asset = building_asset(mats=[material(shader="DSP/Additive"), material(shader="DSP/Unlit")])
    with pytest.raises(ExtractError, match="no renderable submesh"):
        build_building_glb(asset)
