import copy
import json

import pytest

from convert_fakes import make_raw
from tools.extract.convert import protoset
from tools.extract.convert.rawdata import load_raw


@pytest.fixture
def raw(tmp_path):
    return load_raw(make_raw(tmp_path))


def test_go_wrapper_structure(raw):
    out = protoset.to_go(raw.protosets["Item"], "Item")
    assert list(out) == ["Type", "TableName", "Signature", "DataArray"]
    assert out["Type"] == "ItemProtoSet" and out["TableName"] == "Item" and out["Signature"] == "SIGItem"
    first = out["DataArray"][0]
    assert list(first) == ["Name", "ID", "SID", "Proto"]
    assert (first["Name"], first["ID"], first["SID"]) == ("铁矿", 1001, "")
    assert "Name" not in first["Proto"] and "ID" not in first["Proto"] and "SID" not in first["Proto"]
    assert "gameVersion" not in out and "m_Name" not in out


def test_go_keeps_raw_order_and_all_entries(raw):
    out = protoset.to_go(raw.protosets["Item"], "Item")
    assert [e["ID"] for e in out["DataArray"]] == [1001, 2001, 2303, 9999]


def test_bool_fields_become_bool_others_stay_numbers(raw):
    p = protoset.to_go(raw.protosets["Item"], "Item")["DataArray"][1]["Proto"]
    assert p["CanBuild"] is True and p["IsFluid"] is False and p["Productive"] is False
    assert p["Grade"] == 1 and p["ModelIndex"] == 35 and p["Upgrades"] == [2001, 2002]
    t = protoset.to_go(raw.protosets["Tech"], "Tech")["DataArray"]
    assert t[0]["Proto"]["Published"] is True and t[1]["Proto"]["Published"] is False
    assert t[1]["Proto"]["PreTechsMax"] is True and t[1]["Proto"]["IsHiddenTech"] == 1  # not in BOOL_FIELDS
    r = protoset.to_go(raw.protosets["Recipe"], "Recipe")["DataArray"][1]["Proto"]
    assert r["Explicit"] is True and r["NonProductive"] is True and r["Handcraft"] is False


def test_vec2_fields_use_uppercase_xy(raw):
    p = protoset.to_go(raw.protosets["Item"], "Item")["DataArray"][0]["Proto"]
    assert p["EnemyDropRange"] == {"X": 1.5, "Y": 2.5}


def test_missing_wrapper_keys_default(raw):
    s = copy.deepcopy(raw.protosets["Signal"])
    del s["dataArray"][0]["SID"], s["dataArray"][0]["Name"]
    e = protoset.to_go(s, "Signal")["DataArray"][0]
    assert e["Name"] == "" and e["SID"] == ""


def test_frontend_icon_path_style():
    f = protoset.fe_icon_path
    assert f("Icons/ItemRecipe/darkfog-lens") == "icons/item_recipe/darkfog-lens"
    assert f("Icons/Tech/1") == "icons/tech/1"
    assert f("Icons/Signal/signal-501") == "icons/signal/signal-501"
    assert f("") == ""


def test_frontend_converts_only_icon_path_and_does_not_touch_go(raw):
    go = protoset.to_go(raw.protosets["Item"], "Item")
    before = copy.deepcopy(go)
    fe = protoset.to_frontend(go)
    assert go == before, "to_frontend must not mutate its input"
    assert fe["DataArray"][0]["Proto"]["IconPath"] == "icons/item_recipe/iron-ore"
    assert go["DataArray"][0]["Proto"]["IconPath"] == "Icons/ItemRecipe/iron-ore"
    assert {k: v for k, v in fe["DataArray"][0]["Proto"].items() if k != "IconPath"} == \
        {k: v for k, v in go["DataArray"][0]["Proto"].items() if k != "IconPath"}


def test_dump_is_indent2_utf8_without_trailing_newline():
    b = protoset.dump({"a": ["铁"], "b": 1})
    assert b == '{\n  "a": [\n    "铁"\n  ],\n  "b": 1\n}'.encode("utf-8")


def test_dump_matches_existing_sibling_files_byte_for_byte():
    import os
    p = "/Users/codfrm/Code/dsp2b/dsp2b-go/data/signalProtoSet.json"
    if not os.path.exists(p):
        pytest.skip("sibling repo not present")
    data = open(p, "rb").read()
    assert protoset.dump(json.loads(data)) == data


# ---------------------------------------------------------------- compatibility report

def _old(raw):
    return protoset.to_go(raw.protosets["Item"], "Item")


def test_compat_identical_has_no_differences(raw):
    r = protoset.compat_report(_old(raw), _old(raw))
    assert r["compared"] == 4 and r["added"] == [] and r["removed"] == [] and r["changed"] == []


def test_compat_lists_added_removed_and_changed(raw):
    old = _old(raw)
    new = copy.deepcopy(old)
    new["DataArray"].append({"Name": "新", "ID": 5000, "SID": "", "Proto": {"Grade": 0}})
    del new["DataArray"][0]
    new["DataArray"][0]["Proto"]["Grade"] = 7
    r = protoset.compat_report(new, old)
    assert r["added"] == [5000] and r["removed"] == [1001]
    assert [(c["id"], c["field"], c["old"], c["new"]) for c in r["changed"]] == [(2001, "Grade", 1, 7)]
    assert r["compared"] == 3


def test_compat_ignores_fields_present_on_one_side_only(raw):
    old = _old(raw)
    new = copy.deepcopy(old)
    new["DataArray"][1]["Proto"]["BrandNew"] = 1
    del new["DataArray"][2]["Proto"]["BuildIndex"]
    r = protoset.compat_report(new, old)
    assert r["changed"] == []
    assert r["new_fields"] == ["BrandNew"] and r["dropped_fields"] == ["BuildIndex"]


def test_compat_renders_text_summary(raw):
    old = _old(raw)
    new = copy.deepcopy(old)
    new["DataArray"][0]["Name"] = "铁"
    text = protoset.format_report("itemProtoSet.json", protoset.compat_report(new, old))
    assert "itemProtoSet.json" in text and "1001" in text and "Name" in text
