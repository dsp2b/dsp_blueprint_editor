import numpy as np
import pytest

from tools.extract.models.belt import build_belt_glbs
from tools.extract.models.sorter import build_sorter_glb, SORTER_TIERS, SORTER_LODS
from tools.extract.models.validation import validate_glbs

from glbsynth import accessor, belt_source, read_glb, sorter_asset


def node_by_name(g, name):
    return next(n for n in g["nodes"] if n["name"] == name)


def test_belt_has_segment_and_both_head_caps_per_tier():
    out = build_belt_glbs(belt_source())
    assert sorted(out) == [1, 2, 3]
    for tier, (data, info) in out.items():
        g, _ = read_glb(data)
        assert [n["name"] for n in g["nodes"]] == ["segment", "head-short", "head-long"]
        assert info["bytes"] == len(data) and info["triangles"]["segment"] == 4
        assert {m["name"] for m in g["materials"]} == {f"belt-mk{tier}", f"belt-head-mk{tier}"}


def test_belt_scroll_speed_and_tier_colours_go_into_material_extras():
    out = build_belt_glbs(belt_source())
    g, _ = read_glb(out[2][0])
    seg = next(m for m in g["materials"] if m["name"] == "belt-mk2")
    assert seg["extras"]["uvSpeed"] == 1.0
    assert seg["extras"]["scrollTexRepeatsPerSecond"] == 1.0 * 3.529412
    assert out[2][1]["color"] == [0.9, 0.5, 0.1, 1.0] and out[2][1]["uvSpeed"] == 1.0
    # emission texture is sampled with the second UV set
    assert seg["emissiveTexture"]["texCoord"] == 1


def test_belt_head_caps_are_offset_mirrored_and_tiers_differ():
    out = build_belt_glbs(belt_source())
    g1, _ = read_glb(out[1][0])
    assert node_by_name(g1, "head-short")["translation"] == [-1.6, 0, 0]
    assert node_by_name(g1, "head-long")["translation"] == [-2.6, 0, 0]
    assert out[1][0] != out[2][0]


def test_belt_glbs_validate_and_are_deterministic(tmp_path):
    a, b = build_belt_glbs(belt_source()), build_belt_glbs(belt_source())
    paths = []
    for tier, (data, _) in a.items():
        assert data == b[tier][0]
        p = tmp_path / f"belt-mk{tier}.glb"
        p.write_bytes(data)
        paths.append(p)
    for r in validate_glbs(paths):
        assert (r["errors"], r["warnings"]) == (0, 0), r


def test_sorter_parts_are_split_by_end_frame_with_visibility_extras():
    data, info = build_sorter_glb(1, 0, sorter_asset())
    g, _ = read_glb(data)
    names = [n["name"] for n in g["nodes"]]
    assert sorted(names) == sorted(["ACap", "ARail", "BCap", "BRail", "ATop", "BTop", "grabber", "grabberLoaded", "topBeam", "arrow"])
    assert node_by_name(g, "ARail")["extras"] == {"frame": "A", "visible": "only if pick end is on a building (t1=1)"}
    assert node_by_name(g, "BCap")["extras"] == {"frame": "B"}
    assert node_by_name(g, "grabberLoaded")["extras"]["visible"] == "only while carrying an item"
    # B end sits 2 m along +Z of the A end at the default pose
    assert node_by_name(g, "BCap")["translation"] == [0, 0, 2.0] and "translation" not in node_by_name(g, "ACap")
    assert info["total"] == sum(info["triangles"].values()) == 11 and info["lod"] == 0


def test_sorter_stretched_parts_carry_frame_attribute_and_baked_default_pose():
    data, _ = build_sorter_glb(1, 0, sorter_asset())
    g, binc = read_glb(data)
    for name in ("topBeam", "arrow"):
        mesh = g["meshes"][node_by_name(g, name)["mesh"]]
        attrs = mesh["primitives"][0]["attributes"]
        frame = accessor(g, binc, attrs["_FRAME"])
        assert set(frame.tolist()) == {0.0, 1.0}
        pos = accessor(g, binc, attrs["POSITION"])
        # ATop = (0,1,1.03), BTop = (0,1,2-1.03): each vertex is shifted onto the frame it follows
        assert np.all(pos[:, 1] >= 0.99)
        if name == "arrow":  # quad: z = -0.5 at the ATop end, +0.5 at the BTop end
            assert pos[frame == 0][:, 2] == pytest.approx([1.03 - 0.5] * 2)
            assert pos[frame == 1][:, 2] == pytest.approx([0.97 + 0.5] * 2)
    assert "_FRAME" not in g["meshes"][node_by_name(g, "BCap")["mesh"]]["primitives"][0]["attributes"]


def test_sorter_arrow_material_extras_and_unlit_blend():
    data, _ = build_sorter_glb(3, 0, sorter_asset(3))
    g, _ = read_glb(data)
    arrow = next(m for m in g["materials"] if m["name"] == "inserter-arrow")
    assert arrow["extras"]["arrowSpeed"] == 1.5 and arrow["extras"]["offPowerColor"] == [0.3, 0.3, 0.3, 1]
    assert arrow["alphaMode"] == "BLEND" and "KHR_materials_unlit" in g["extensionsUsed"]
    assert arrow["pbrMetallicRoughness"]["baseColorFactor"] == [1, 1, 0.5, 0.8]
    body = next(m for m in g["materials"] if m["name"] == "inserter-3")
    assert "baseColorTexture" in body["pbrMetallicRoughness"]


def test_sorter_tiers_and_lods_are_four_by_two_and_glbs_validate(tmp_path):
    assert SORTER_TIERS == (1, 2, 3, 4) and SORTER_LODS == (0, 2)
    paths = []
    for tier in SORTER_TIERS:
        for lod in SORTER_LODS:
            data, info = build_sorter_glb(tier, lod, sorter_asset(tier))
            assert data == build_sorter_glb(tier, lod, sorter_asset(tier))[0]
            p = tmp_path / f"s{tier}-{lod}.glb"
            p.write_bytes(data)
            paths.append(p)
            assert info["lod"] == lod
    for r in validate_glbs(paths):
        assert (r["errors"], r["warnings"]) == (0, 0), r
