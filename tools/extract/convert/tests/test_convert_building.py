import json
import os
import re
from pathlib import Path

import pytest

from convert_fakes import make_raw
from tools.extract.convert import building
from tools.extract.convert.rawdata import load_raw

REAL_RAW = Path(os.environ.get("DSP_RAW_DIR", "/tmp/dsp_t1/out_remote/raw/0.10.35"))
OLD = json.loads((Path(__file__).parent / "fixtures" / "old_building_table.json").read_text(encoding="utf-8"))
OVERRIDDEN = {"35", "36", "37", "41", "42", "43", "483"}


@pytest.fixture
def raw(tmp_path):
    return load_raw(make_raw(tmp_path))


def by_index(models):
    return {m["modelIndex"]: m for m in models}


def test_override_list_is_exactly_the_seven_belt_and_sorter_boxes_with_reasons():
    assert {str(k) for k in building.OVERRIDES} == OVERRIDDEN
    for k, o in building.OVERRIDES.items():
        assert o["box"] and o["offset"] and len(o["reason"]) > 15, k


def test_game_values_map_to_box_offset_and_sort_by_model_index(raw):
    models = building.build_models(raw.buildings)
    assert [m["modelIndex"] for m in models] == [35, 39, 41, 57, 65, 70]
    m = by_index(models)[65]
    assert m["box"] == [4.2, 4.6, 4.2] and m["offset"] == [0.0, 2.3, 0.0]
    assert m["slotPoses"] == [] and m["insertPoses"] == building_pose()


def building_pose():
    return [{"pos": [0.0, 0.0, 0.25], "rot": [0.0, 0.0, 0.0, 1.0]}]


def test_tint_becomes_srgb_hex_and_null_tint_stays_null(raw):
    m = by_index(building.build_models(raw.buildings))
    assert m[65]["color"] == 0xFFA84E
    assert m[70]["color"] == 0xFFFFFF
    assert m[57]["color"] is None
    assert m[39]["slotPoses"] == building_pose()


def test_overrides_replace_box_and_offset_only_and_keep_game_tint(raw):
    m = by_index(building.build_models(raw.buildings))
    assert m[35]["box"] == [0.64, 0.12, 0.64] and m[35]["offset"] == [0.0, 0.05, 0.0]
    assert m[35]["color"] == 0xE3A263, "belts have no tint: the override supplies their tier colour"
    assert m[35]["overridden"] and "reason" not in m[35]
    assert m[41]["box"] == [1.0, 1.0, 1.0] and m[41]["offset"] == [0.0, 0.0, 0.0]
    assert m[41]["color"] == 0xFFB74C and m[41]["overridden"]
    assert not m[65]["overridden"] and not m[39]["overridden"]


def test_work_params_use_interface_names_and_drop_the_rest(raw):
    m = by_index(building.build_models(raw.buildings))
    assert m[65]["work"] == {"assemblerSpeed": 7500}
    assert m[70]["work"] == {"labSpeed": 10000}
    assert m[35]["work"] == {"beltSpeed": 1}
    assert m[41]["work"] == {"inserterSpeed": 200000}
    assert m[57]["work"] == {"minerSpeed": 1200000}
    assert m[39]["work"] == {}


def test_building_ts_header_names_generator_and_version(raw):
    ts = building.building_ts(raw.buildings, raw.version)
    assert ts.startswith("// ")
    head = ts.split("import", 1)[0]
    assert "generated" in head.lower() and "python -m tools.extract" in head and "0.10.35" in head
    assert "buildingMetaRaw" in ts and "export const buildingMeta" in ts
    assert "export const noIconBuildings" in ts


def test_building_ts_rows_carry_name_comment_poses_and_work(raw):
    ts = building.building_ts(raw.buildings, raw.version)
    row = next(l for l in ts.splitlines() if l.lstrip().startswith("[ 65,") or l.lstrip().startswith("[65,"))
    assert "0xFFA84E" in row and "box: [4.2, 4.6, 4.2]" in row and "offset: [0.0, 2.3, 0.0]" in row
    assert "assemblerSpeed: 7500" in row and "// 制造台 Mk.I" in row
    assert "pos: [0.0, 0.0, 0.25]" in row and "rot: [0.0, 0.0, 0.0, 1.0]" in row
    row35 = next(l for l in ts.splitlines() if re.match(r"\s*\[\s*35,", l))
    assert "color: 0xE3A263" in row35 and "// 低速传送带" in row35
    row57 = next(l for l in ts.splitlines() if re.match(r"\s*\[\s*57,", l))
    assert "color: null" in row57


def test_building_ts_is_deterministic(raw):
    assert building.building_ts(raw.buildings, raw.version) == building.building_ts(raw.buildings, raw.version)


# ---------------------------------------------------------------- golden check on the real 0.10.35 raw output

@pytest.mark.skipif(not (REAL_RAW / "buildings.json").exists(), reason="real 0.10.35 raw output not available")
def test_golden_real_raw_52_match_7_overridden_39_40_game():
    models = by_index(building.build_models(load_raw(REAL_RAW).buildings))
    assert len(models) == 67 and {117, 664} <= set(models)
    matched = []
    for idx, old in OLD.items():
        m = models[int(idx)]
        same = all(abs(a - b) < 0.011 for a, b in zip(m["box"] + m["offset"], old["box"] + old["offset"]))
        if idx in OVERRIDDEN:
            assert m["overridden"] and m["box"] == old["box"] and m["offset"] == old["offset"], idx
            continue
        if idx in ("39", "40"):
            assert not same and not m["overridden"], idx  # the old copy mistakes: game values win
            continue
        assert same, idx
        matched.append(idx)
    assert len(matched) == 52
    assert models[39]["box"] == [2.0, 2.94, 2.7] and models[40]["box"] == [2.7, 2.96, 2.7]
    assert models[65]["color"] == 0xFFA84E
