import pytest

from convert_fakes import make_raw
from tools.extract.convert import preview, translations
from tools.extract.convert.rawdata import load_raw
from tools.extract.errors import ExtractError


@pytest.fixture
def raw(tmp_path):
    return load_raw(make_raw(tmp_path))


def test_items_ts_maps_fields_skips_gridindex_zero(raw):
    ts = preview.items_ts(raw.protosets["Item"])
    assert ts.startswith("import { Item } from './types';\n\nexport const items: Item[] = [\n")
    assert "9999" not in ts
    assert ("    {\n"
            "        id: 1001, models: [], grid: [1, 1, 1],\n"
            "        name: '铁矿', icon: 'iron-ore',\n"
            "        grade: 0, upgrades: [], buildIndex: 0,\n"
            "        productive: true,\n"
            "    },\n") in ts
    assert "id: 2303, models: [65, 66], grid: [2, 5, 1]," in ts
    assert "grade: 1, upgrades: [2001, 2002], buildIndex: 301," in ts
    assert ts.endswith("];\n")


def test_items_ts_escapes_quotes_in_names():
    s = {"dataArray": [{"ID": 1, "Name": "it's", "IconPath": "Icons/ItemRecipe/x", "ModelIndex": 0, "ModelCount": 0,
                        "GridIndex": 1101, "Productive": 0, "Grade": 0, "Upgrades": [], "BuildIndex": 0}]}
    assert "name: 'it\\'s'" in preview.items_ts(s)


def test_recipes_ts(raw):
    ts = preview.recipes_ts(raw.protosets["Recipe"])
    assert "import { itemsMap } from './items';" in ts
    assert "id: 1, name: '铁块', time: 60," in ts
    assert "{item: itemsMap.get(1001)!, count: 1}," in ts and "{item: itemsMap.get(2001)!, count: 3}," in ts
    assert "grid: [1, 2, 2]," in ts
    assert ts.count("icon: '") == 1 and "icon: 'magnet'," in ts
    assert ts.count("nonProductive: true,") == 1


def test_midi_ts(raw):
    ts = preview.midi_ts(raw.protosets["MIDI"])
    assert "{id: 1, isInstrument: true, pitchRange: [6, 101]}," in ts
    assert "{id: 2, isInstrument: false, pitchRange: [1, 2]}," in ts
    assert ts.endswith("for (const m of midi)\n    midiMap.set(m.id, m);\n")


def test_signal_ts_grid_pos_and_page_check(raw):
    ts = preview.signal_ts(raw.protosets["Signal"])
    assert "{id: 501, gridPos: [1, 0]}," in ts and "{id: 503, gridPos: [1, 2]}," in ts
    bad = {"dataArray": [{"ID": 1, "GridIndex": 1101}]}
    with pytest.raises(ExtractError):
        preview.signal_ts(bad)


def test_tech_ts_lists_published_only(raw):
    ts = preview.tech_ts(raw.protosets["Tech"])
    assert "{id: 1}," in ts and "{id: 2}," not in ts


# ---------------------------------------------------------------- translations

def test_translations_required_keys_first_sorted_then_existing_extras(raw):
    out, notes = translations.build_translations(raw.locales, raw.protosets, extra_keys=["UI确定", "zzz缺失"])
    assert list(out["zh"]) == sorted(["铁矿", "低速传送带", "制造台 Mk.I", "铁块", "磁铁"]) + ["UI确定"]
    assert out["en"]["铁矿"] == "Iron Ore" and out["en"]["UI确定"] == "OK" and out["zh"]["UI确定"] == "确定"
    assert any("zzz缺失" in n for n in notes), "an extra key the game lacks is reported, not fatal"
    assert "隐藏" not in out["zh"], "items without a grid slot need no translation"


def test_translations_missing_required_key_is_an_error_listing_it(raw):
    del raw.locales[1033]["tables"]["prototype"]["磁铁"]
    with pytest.raises(ExtractError, match="磁铁"):
        translations.build_translations(raw.locales, raw.protosets, extra_keys=[])


def test_translations_empty_text_is_dropped(raw):
    raw.locales[2052]["tables"]["prototype"]["磁铁"] = ""
    out, _ = translations.build_translations(raw.locales, raw.protosets, extra_keys=[])
    assert "磁铁" not in out["zh"] and "磁铁" in out["en"]
