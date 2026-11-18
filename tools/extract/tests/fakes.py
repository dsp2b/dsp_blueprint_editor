"""Test doubles: a tiny fake game install, a fake Unity reader and a fake remote host.

None of them touch the real game or the network.
"""
import copy
import shutil
import uuid
from pathlib import Path

from PIL import Image

from tools.extract.prefab import Component, Node

LOCALE_HEADER = (
    "[Localization Project]\r\n"
    "Version=1.1\r\n"
    "2052,简体中文,zh-CN,zh,1033,1\r\n"
    "1033,English,en-US,en,2052,0\r\n"
    "1042,한국어,ko-KO,ko,1033,1,0\r\n"
    "\r\n"
    "base=0\r\n"
    "prototype=-1\r\n"
)

LOCALE_TABLES = {
    "2052": {
        "base": "确定\t\t5\t确定\r\n传送带\t\t5\t传送带\r\n",
        "prototype": "制造台 Mk.I\t\t5\t制造台 Mk.I\r\n带\t制表\t5\t左\t右\r\n坏行\r\n",
    },
    "1033": {
        "base": "确定\t\t5\tOK\r\n传送带\t\t5\tConveyor belt MK.I\r\n",
        "prototype": "制造台 Mk.I\t\t5\tAssembling machine Mk.I\r\n",
    },
}

GAME_FILES = [
    "DSPGAME_Data/globalgamemanagers",
    "DSPGAME_Data/globalgamemanagers.assets",
    "DSPGAME_Data/resources.assets",
    "DSPGAME_Data/resources.assets.resS",
    "DSPGAME_Data/sharedassets0.assets",
    "DSPGAME_Data/sharedassets0.assets.resS",
    "DSPGAME_Data/Managed/Assembly-CSharp.dll",
    "DSPGAME_Data/Managed/UnityEngine.CoreModule.dll",
]


def make_game_dir(root: Path, missing=()) -> Path:
    """Create a fake DSP install under root. Paths in `missing` are left out."""
    for rel in GAME_FILES:
        if rel in missing:
            continue
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"fake:" + rel.encode())
    if "Locale/Header.txt" not in missing:
        (root / "Locale").mkdir(parents=True, exist_ok=True)
        (root / "Locale/Header.txt").write_bytes(b"\xff\xfe" + LOCALE_HEADER.encode("utf-16-le"))
    for lcid, tables in LOCALE_TABLES.items():
        for name, text in tables.items():
            rel = f"Locale/{lcid}/{name}.txt"
            if rel in missing:
                continue
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"\xff\xfe" + text.encode("utf-16-le"))
    return root


def node(nid, name, children=(), components=(), active=True,
         pos=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0, 1.0), scale=(1.0, 1.0, 1.0)):
    return Node(id=nid, name=name, active=active, pos=pos, rot=rot, scale=scale,
                components=list(components), children=list(children))


def mono(script, **data):
    return Component(kind="MonoBehaviour", script=script, data=data)


def renderer(*colors, kind="MeshRenderer"):
    mats = [{"name": f"mat{i}", "colors": {"_Color": c} if c is not None else {}} for i, c in enumerate(colors)]
    return Component(kind=kind, script=None, data=None, materials=lambda: mats)


def pptr(pid, fid=0):
    return {"m_FileID": fid, "m_PathID": pid}


def v3(x, y, z):
    return {"x": x, "y": y, "z": z}


# 90 degrees about +Y
ROT_Y90 = (0.0, 0.7071067690849304, 0.0, 0.7071067690849304)


def belt_prefab():
    return node(100, "belt-1", components=[
        mono("BeltDesc", beltPrototype=2001, speed=1),
        mono("SlotConfig", selectCenter=v3(0.0, 0.10000000149011612, 0.0), selectSize=v3(1.0, 0.5, 1.0),
             slotPoses=[], insertPoses=[]),
    ])


def assembler_prefab():
    slot = node(202, "slot0", pos=(1.0, 0.0, 0.0))
    ins = node(203, "ins0", pos=(0.0, 0.5, 2.0), rot=ROT_Y90)
    arm = node(201, "arm", pos=(0.0, 1.0, 0.0), rot=ROT_Y90, children=[slot])
    hidden = node(204, "hidden", active=False, components=[renderer((0.0, 0.0, 1.0, 1.0))])
    body = node(205, "body", components=[renderer((1.0, 0.6596300005912781, 0.3066037893295288, 1.0),
                                                  (0.0, 0.0, 0.0, 1.0))])
    return node(200, "assembler-mk-1", children=[hidden, arm, ins, body], components=[
        mono("SlotConfig", selectCenter=v3(0.0, 2.299999952316284, 0.0),
             selectSize=v3(4.199999809265137, 4.599999904632568, 4.199999809265137),
             slotPoses=[pptr(202)], insertPoses=[pptr(203)]),
        mono("AssemblerDesc", recipeType=4, speedf=0.75),
        mono("PowerDesc", consumer=1, workEnergyPerTick=4500, idleEnergyPerTick=200),
        mono("AnimDesc", prepare_length=0.0, working_length=5.0),
    ])


def default_protosets():
    items = [
        {"ID": 1001, "Name": "铁矿", "CanBuild": 0, "ModelIndex": 0, "ModelCount": 0, "Grade": 0,
         "Upgrades": [], "BuildIndex": 0, "IconPath": "Icons/ItemRecipe/iron-ore"},
        {"ID": 2001, "Name": "传送带", "CanBuild": 1, "ModelIndex": 35, "ModelCount": 1, "Grade": 1,
         "Upgrades": [2001, 2002, 2003], "BuildIndex": 301, "IconPath": "Icons/ItemRecipe/belt-1"},
        {"ID": 2303, "Name": "制造台 Mk.I", "CanBuild": 1, "ModelIndex": 65, "ModelCount": 1, "Grade": 1,
         "Upgrades": [2303, 2304], "BuildIndex": 501, "IconPath": "Icons/ItemRecipe/assembler-1"},
        {"ID": 1131, "Name": "地基", "CanBuild": 1, "ModelIndex": 0, "ModelCount": 0, "Grade": 0,
         "Upgrades": [], "BuildIndex": 901, "IconPath": "Icons/ItemRecipe/foundation"},
    ]
    return {
        "ItemProtoSet": {"m_Name": "ItemProtoSet", "TableName": "Item", "dataArray": items},
        "RecipeProtoSet": {"m_Name": "RecipeProtoSet", "TableName": "Recipe", "dataArray": [
            {"ID": 1, "Name": "铁块", "IconPath": ""},
            {"ID": 2, "Name": "齿轮", "IconPath": "Icons/ItemRecipe/gear"},
        ]},
        "TechProtoSet": {"m_Name": "TechProtoSet", "TableName": "Tech", "dataArray": [
            {"ID": 1001, "Name": "电磁学", "IconPath": "Icons/Tech/1001"},
        ]},
        "SignalProtoSet": {"m_Name": "SignalProtoSet", "TableName": "Signal", "dataArray": [
            {"ID": 401, "Name": "信号", "IconPath": "Icons/Signal/signal-401"},
        ]},
        "ModelProtoSet": {"m_Name": "ModelProtoSet", "TableName": "Model", "dataArray": [
            {"ID": 1, "Name": "1", "PrefabPath": ""},
            {"ID": 35, "Name": "35", "PrefabPath": "Entities/Prefabs/belt-1"},
            {"ID": 65, "Name": "65", "PrefabPath": "Entities/Prefabs/assembler-mk-1"},
            {"ID": 300, "Name": "300", "PrefabPath": "Entities/Prefabs/no-slot-config"},
        ]},
        "MIDIProtoSet": {"m_Name": "MIDIProtoSet", "TableName": "MIDI", "dataArray": [
            {"ID": 1, "Instrument": 1, "PitchRange": 0},
        ]},
    }


def default_prefabs():
    return {
        "Entities/Prefabs/belt-1": belt_prefab(),
        "Entities/Prefabs/assembler-mk-1": assembler_prefab(),
        "Entities/Prefabs/no-slot-config": node(300, "no-slot-config", components=[renderer((1, 1, 1, 1))]),
    }


def default_icons():
    colors = {
        "Icons/ItemRecipe/iron-ore": (120, 80, 60, 255),
        "Icons/ItemRecipe/belt-1": (200, 150, 0, 255),
        "Icons/ItemRecipe/assembler-1": (0, 150, 200, 255),
        "Icons/ItemRecipe/foundation": (90, 90, 90, 255),
        "Icons/ItemRecipe/gear": (10, 20, 30, 255),
        "Icons/Tech/1001": (1, 2, 3, 255),
        "Icons/Signal/signal-401": (4, 5, 6, 128),
    }
    return {k: Image.new("RGBA", (4, 4), c) for k, c in colors.items()}


class FakeReader:
    """Stands in for the UnityPy-backed reader; returns plain data."""

    def __init__(self, source, *, version="0.10.35", protosets=None, prefabs=None, icons=None,
                 reverse_models=False, fail_on=None):
        self.source = source
        self._version = version
        self._protosets = protosets if protosets is not None else default_protosets()
        self._prefabs = prefabs if prefabs is not None else default_prefabs()
        self._icons = icons if icons is not None else default_icons()
        self.reverse_models = reverse_models
        self.fail_on = fail_on
        self.calls = []

    def version(self):
        self.calls.append("version")
        return self._version

    def protoset(self, name):
        self.calls.append(("protoset", name))
        if self.fail_on == name:
            raise RuntimeError(f"boom while reading {name}")
        from tools.extract.errors import ExtractError
        if name not in self._protosets:
            raise ExtractError(f"ProtoSet {name} not found in resources.assets")
        ps = copy.deepcopy(self._protosets[name])
        if self.reverse_models and name == "ModelProtoSet":
            ps["dataArray"].reverse()
        return ps

    def prefab(self, path, scripts):
        self.calls.append(("prefab", path))
        return self._prefabs.get(path)

    def icons(self, paths):
        self.calls.append(("icons", tuple(paths)))
        return {p: self._icons[p].copy() for p in paths if p in self._icons}


def reader_factory(**kwargs):
    readers = []

    def factory(source, log=None):
        r = FakeReader(source, **kwargs)
        readers.append(r)
        return r

    factory.readers = readers
    return factory


class FakeHost:
    """In-memory stand-in for the opsctl-backed remote host.

    `game_root` plays the remote game directory (read-only); `temp_root` plays the remote
    machine's temp area. Records every call so tests can assert on cleanup.
    """

    def __init__(self, game_root: Path, temp_root: Path, fail_extract=False):
        self.game_root = Path(game_root)
        self.temp_root = Path(temp_root)
        self.temp_root.mkdir(parents=True, exist_ok=True)
        self.fail_extract = fail_extract
        self.calls = []
        self.created = []

    def list_dir(self, game_dir, rel):
        self.calls.append(("list_dir", rel))
        p = self.game_root / rel
        if not p.is_dir():
            return None
        return {c.name: (c.stat().st_size if c.is_file() else None) for c in p.iterdir()}

    def make_temp_dir(self):
        d = self.temp_root / f"dsp-extract-{uuid.uuid4().hex}"
        d.mkdir()
        self.created.append(d)
        self.calls.append(("make_temp_dir", str(d)))
        return str(d)

    def remove_temp_dir(self, path):
        self.calls.append(("remove_temp_dir", path))
        shutil.rmtree(path)

    def extract_ranges(self, game_dir, temp_dir, ranges):
        self.calls.append(("extract_ranges", temp_dir, list(ranges)))
        assert Path(temp_dir).is_dir(), "temp dir must exist before extracting"
        # the real host writes scratch files into the temp dir; mimic that
        (Path(temp_dir) / "ranges.txt").write_text("\n".join(f"{r}\t{o}\t{n}" for r, o, n in ranges))
        if self.fail_extract:
            raise RuntimeError("remote range read failed")
        out = bytearray()
        for rel, off, n in ranges:
            with open(self.game_root / rel, "rb") as f:
                f.seek(off)
                data = f.read(n)
            if len(data) != n:
                raise RuntimeError(f"short read {rel}")
            out += data
        return bytes(out)
