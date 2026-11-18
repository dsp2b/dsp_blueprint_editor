"""A tiny hand-made raw extraction directory (what tools/extract/raw.py writes) for converter tests."""
import json
from pathlib import Path

from PIL import Image

VERSION = "0.10.35"


def _set(table, entries):
    return {"gameVersion": VERSION, "m_Name": table + "ProtoSet", "TableName": table,
            "Signature": "SIG" + table, "dataArray": entries}


def item(id, name, grid, **kw):
    d = {"Name": name, "ID": id, "SID": "", "Type": 1, "Grade": 0, "Upgrades": [], "IsFluid": 0, "IsEntity": 0,
         "CanBuild": 0, "BuildInGas": 0, "IconPath": f"Icons/ItemRecipe/icon-{id}", "ModelIndex": 0,
         "ModelCount": 0, "BuildIndex": 0, "GridIndex": grid, "Productive": 0,
         "EnemyDropRange": {"x": 1.5, "y": 2.5}}
    d.update(kw)
    return d


ITEMS = [
    item(1001, "铁矿", 1101, Productive=1, IconPath="Icons/ItemRecipe/iron-ore"),
    item(2001, "低速传送带", 2101, CanBuild=1, ModelIndex=35, ModelCount=1, Grade=1, Upgrades=[2001, 2002],
         BuildIndex=301, IconPath="Icons/ItemRecipe/belt-1"),
    item(2303, "制造台 Mk.I", 2501, CanBuild=1, ModelIndex=65, ModelCount=2, BuildIndex=401, IsEntity=1,
         IconPath="Icons/ItemRecipe/assembler-1"),
    item(9999, "隐藏", 0),
]
RECIPES = [{"Name": "铁块", "ID": 1, "SID": "1101", "Handcraft": 1, "Explicit": 0, "TimeSpend": 60,
            "Items": [1001], "ItemCounts": [1], "Results": [2001], "ResultCounts": [2], "GridIndex": 1101,
            "IconPath": "", "NonProductive": 0},
           {"Name": "磁铁", "ID": 2, "SID": "", "Handcraft": 0, "Explicit": 1, "TimeSpend": 90,
            "Items": [1001, 2001], "ItemCounts": [1, 3], "Results": [2303], "ResultCounts": [1], "GridIndex": 1202,
            "IconPath": "Icons/ItemRecipe/magnet", "NonProductive": 1}]
TECHS = [{"Name": "T一", "ID": 1, "SID": "", "Published": 1, "IsHiddenTech": 0, "IsObsolete": 0, "IsLabTech": 0,
          "PreTechsMax": 0, "IconPath": "Icons/Tech/1"},
         {"Name": "T二", "ID": 2, "SID": "", "Published": 0, "IsHiddenTech": 1, "IsObsolete": 0, "IsLabTech": 0,
          "PreTechsMax": 1, "IconPath": "Icons/Tech/2"}]
SIGNALS = [{"Name": "SIGNAL-501", "ID": 501, "SID": "", "GridIndex": 3201, "IconPath": "Icons/Signal/signal-501"},
           {"Name": "SIGNAL-503", "ID": 503, "SID": "", "GridIndex": 3203, "IconPath": "Icons/Signal/signal-503"}]
MIDIS = [{"Name": "piano-1", "ID": 1, "SID": "", "Instrument": 1, "PitchRange": [6, 101]},
         {"Name": "drum", "ID": 2, "SID": "", "Instrument": 0, "PitchRange": [1, 2]}]

POSE = {"pos": [0.0, 0.0, 0.25], "rot": [0.0, 0.0, 0.0, 1.0]}


def model(index, prefab, size, center, tint, work=None, slot=(), insert=()):
    return {"modelIndex": index, "prefab": prefab, "selectSize": size, "selectCenter": center, "tint": tint,
            "work": work or {}, "slotPoses": list(slot), "insertPoses": list(insert)}


MODELS = [
    model(65, "Entities/Prefabs/assembler-1", [4.2, 4.6, 4.2], [0.0, 2.3, 0.0], [1.0, 0.65963, 0.3066038, 1.0],
          {"assemblerSpeed": 7500, "isAssembler": True}, insert=[POSE]),
    model(35, "Entities/Prefabs/belt-1", [1.0, 0.5, 1.0], [0.0, 0.1, 0.0], None, {"beltSpeed": 1}),
    model(41, "Entities/Prefabs/sorter-1", [1.0, 1.0, 1.0], [0.0, 0.5, 0.0], [1.0, 0.71886796, 0.2971698, 1.0],
          {"inserterSTT": 200000}),
    model(39, "Entities/Prefabs/splitter-b", [2.0, 2.94, 2.7], [0.0, 1.47, 0.0], [0.4448, 0.4739, 0.503, 1.0],
          slot=[POSE]),
    model(57, "Entities/Prefabs/miner", [3.8, 3.6, 6.8], [0.0, 1.8, 0.3], None, {"minerPeriod": 1200000}),
    model(70, "Entities/Prefabs/lab", [6.1, 3.1, 6.1], [0.0, 1.55, 0.0], [1.0, 1.0, 1.0, 1.0],
          {"labAssembleSpeed": 10000, "labResearchSpeed": 10000}),
]
BUILDING_ITEMS = [
    {"id": 2001, "name": "低速传送带", "modelIndex": 35, "modelCount": 1, "grade": 1, "upgrades": [2001, 2002],
     "buildIndex": 301},
    {"id": 2303, "name": "制造台 Mk.I", "modelIndex": 65, "modelCount": 2, "grade": 0, "upgrades": [],
     "buildIndex": 401},
]


def locale(lcid, abbr, tables):
    return {"lcid": lcid, "name": abbr, "code": abbr, "abbr": abbr, "fallback": 1033, "tables": tables}


def make_raw(root: Path, version=VERSION) -> Path:
    raw = Path(root) / "raw" / version
    (raw / "protosets").mkdir(parents=True)
    (raw / "locale").mkdir()
    for table, entries in (("Item", ITEMS), ("Recipe", RECIPES), ("Tech", TECHS), ("Signal", SIGNALS),
                           ("MIDI", MIDIS), ("Model", [])):
        (raw / "protosets" / f"{table}ProtoSet.json").write_text(
            json.dumps(_set(table, entries), ensure_ascii=False), encoding="utf-8")
    zh = locale(2052, "zh", {"base": {"铁矿": "铁矿", "UI确定": "确定"},
                             "prototype": {"低速传送带": "低速传送带", "制造台 Mk.I": "制造台 Mk.I", "铁块": "铁块",
                                           "磁铁": "磁铁", "空的": ""}})
    en = locale(1033, "en", {"base": {"铁矿": "Iron Ore", "UI确定": "OK"},
                             "prototype": {"低速传送带": "Conveyor Belt MK.I", "制造台 Mk.I": "Assembling Machine Mk.I",
                                           "铁块": "Iron Ingot", "磁铁": "Magnet", "空的": ""}})
    for loc in (zh, en):
        (raw / "locale" / f"{loc['lcid']}.json").write_text(json.dumps(loc, ensure_ascii=False), encoding="utf-8")
    (raw / "buildings.json").write_text(json.dumps(
        {"gameVersion": version, "items": BUILDING_ITEMS, "models": MODELS}, ensure_ascii=False), encoding="utf-8")
    for sub, name in (("item_recipe", "iron-ore"), ("tech", "1"), ("signal", "signal-501")):
        d = raw / "icons" / sub
        d.mkdir(parents=True)
        Image.new("RGBA", (4, 4), (1, 2, 3, 255)).save(d / f"{name}.png")
    return raw
