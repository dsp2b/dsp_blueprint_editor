"""Reads a raw extraction directory (`<out>/raw/<version>/`, written by tools/extract/raw.py)."""
import json
from dataclasses import dataclass, field
from pathlib import Path

from ..errors import ExtractError

PROTOSETS = ("Item", "Recipe", "Tech", "Signal", "Model", "MIDI")


@dataclass
class RawData:
    path: Path
    version: str
    protosets: dict = field(default_factory=dict)   # "Item" -> parsed ItemProtoSet.json
    locales: dict = field(default_factory=dict)     # lcid -> parsed locale/<lcid>.json
    buildings: dict = field(default_factory=dict)   # parsed buildings.json

    @property
    def icons_dir(self):
        return self.path / "icons"


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ExtractError(f"raw data file missing: {path}") from None


def load_raw(path) -> RawData:
    path = Path(path)
    if not path.is_dir():
        raise ExtractError(f"raw directory not found: {path}")
    protosets = {n: _read_json(path / "protosets" / f"{n}ProtoSet.json") for n in PROTOSETS}
    locales = {}
    for p in sorted((path / "locale").glob("*.json")):
        loc = json.loads(p.read_text(encoding="utf-8"))
        locales[loc["lcid"]] = loc
    buildings = _read_json(path / "buildings.json")
    version = buildings.get("gameVersion") or protosets["Item"].get("gameVersion") or path.name
    return RawData(path, version, protosets, locales, buildings)


def _version_key(name):
    return tuple(int(p) if p.isdigit() else 0 for p in name.split("."))


def find_latest_raw(out_dir) -> Path:
    root = Path(out_dir) / "raw"
    versions = [p for p in root.iterdir() if p.is_dir()] if root.is_dir() else []
    if not versions:
        raise ExtractError(f"no raw extraction under {root}; run the extraction first or pass --raw DIR")
    return max(versions, key=lambda p: _version_key(p.name))
