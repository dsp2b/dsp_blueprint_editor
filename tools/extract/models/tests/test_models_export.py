import json

import pytest

from tools.extract.errors import ExtractError
from tools.extract.models.export import export_models, merge_raw_manifest, write_models
from tools.extract.models.gamedata import BuildingSource

from glbsynth import belt_source, building_asset, sorter_asset


class FakeGame:
    def __init__(self, lods_by_prefab):
        self.lods_by_prefab = lods_by_prefab
        self.loaded = []

    def prepare(self, prefabs):
        self.prepared = list(prefabs)

    def building(self, prefab):
        lods = self.lods_by_prefab.get(prefab)
        return BuildingSource(prefab, lods, [125.0, 180.0, 5000.0][:len(lods)]) if lods else None

    def belt(self):
        return belt_source()

    def sorter(self, tier, lod):
        return sorter_asset(tier)

    def load_textures(self, refs):
        self.loaded += list(refs)


def model(idx, prefab):
    return {"modelIndex": idx, "prefab": prefab, "selectSize": [4.2, 4.6, 4.2], "selectCenter": [0, 2.3, 0]}


MODELS = [model(65, "p/asm"), model(50, "p/station"), model(35, "p/belt-1")]


def game():
    return FakeGame({"p/asm": [building_asset("a0"), building_asset("a1"), building_asset("a2")], "p/station": [building_asset("s0")]})


def test_buildings_export_lod0_and_lowest_and_single_lod_once_and_belts_are_skipped():
    g = game()
    files = export_models(g, MODELS)
    assert g.prepared == ["p/station", "p/asm"] or sorted(g.prepared) == ["p/asm", "p/station"]
    assert {k for k in files if k.startswith("models/") and "/" not in k[7:]} == {"models/65.glb", "models/65.lod0.glb", "models/50.glb", "models/manifest.json"}
    man = json.loads(files["models/manifest.json"])
    b65, b50 = man["buildings"]["65"], man["buildings"]["50"]
    assert (b65["file"], b65["lod"], b65["lod0"]["file"], b65["lod0"]["lod"]) == ("65.glb", 2, "65.lod0.glb", 0)
    assert b65["bytes"] == len(files["models/65.glb"]) and b65["lod0"]["bytes"] == len(files["models/65.lod0.glb"])
    assert b65["triangles"] == 4 and b65["selectSize"] == [4.2, 4.6, 4.2] and b65["lodTriangles"] == [4, 4, 4]
    assert "lod0" not in b50 and b50["lod"] == 0 and "single LOD" in b50["notes"]
    assert "35" not in man["buildings"]


def test_belts_and_four_sorter_tiers_in_both_lods_are_listed():
    files = export_models(game(), MODELS)
    man = json.loads(files["models/manifest.json"])
    assert sorted(man["belts"]) == ["mk1", "mk2", "mk3"] and man["belts"]["mk3"]["file"] == "belt/belt-mk3.glb"
    assert sorted(man["sorters"]) == sorted(f"sorter-mk{t}{s}" for t in (1, 2, 3, 4) for s in ("", "-lod2"))
    assert man["sorters"]["sorter-mk4-lod2"]["lod"] == 2 and man["sorters"]["sorter-mk4"]["lod"] == 0
    assert {"models/belt/belt-mk1.glb", "models/sorter/sorter-mk2-lod2.glb"} <= set(files)
    for entry in [*man["belts"].values(), *man["sorters"].values()]:
        assert entry["bytes"] == len(files["models/" + entry["file"]])


def test_only_textures_the_exported_lods_use_are_loaded():
    g = game()
    export_models(g, MODELS)
    # building materials have _MainTex only; the unused middle LOD is never decoded
    assert g.loaded and all(hasattr(r, "image") for r in g.loaded)


def test_export_is_deterministic_and_missing_lod_model_is_an_error():
    a, b = export_models(game(), MODELS), export_models(game(), MODELS)
    assert a == b and list(a) == list(b)
    with pytest.raises(ExtractError, match="66 \\(p/none\\)"):
        export_models(game(), MODELS + [model(66, "p/none")])


def raw_manifest(extra=None):
    files = {"buildings.json": {"size": 1, "sha256": "x"}, **(extra or {})}
    return json.dumps({"gameVersion": "0.10.35", "files": files, "coverage": {}}).encode()


def test_raw_manifest_lists_every_model_file_and_drops_stale_entries():
    files = export_models(game(), MODELS)
    stale = {"models/old.glb": {"size": 1, "sha256": "y"}}
    merged = json.loads(merge_raw_manifest(raw_manifest(stale), files))
    assert "models/old.glb" not in merged["files"] and "buildings.json" in merged["files"]
    assert set(k for k in merged["files"] if k.startswith("models/")) == set(files)
    assert merged["files"]["models/65.glb"]["size"] == len(files["models/65.glb"])
    assert list(merged["files"]) == sorted(merged["files"])
    assert merge_raw_manifest(merge_raw_manifest(raw_manifest(), files), files) == merge_raw_manifest(raw_manifest(), files)


def test_write_models_replaces_directory_and_rolls_back_on_failure(tmp_path):
    raw = tmp_path / "0.10.35"
    (raw / "models").mkdir(parents=True)
    (raw / "models/stale.glb").write_bytes(b"old")
    (raw / "manifest.json").write_bytes(raw_manifest())
    files = export_models(game(), MODELS)

    def reject(_):
        raise ExtractError("validation failed")
    before = (raw / "manifest.json").read_bytes()
    with pytest.raises(ExtractError):
        write_models(raw, files, reject)
    assert (raw / "models/stale.glb").read_bytes() == b"old" and (raw / "manifest.json").read_bytes() == before
    assert not [p for p in raw.iterdir() if p.name.startswith(".")]

    write_models(raw, files)
    assert not (raw / "models/stale.glb").exists()
    assert (raw / "models/65.glb").read_bytes() == files["models/65.glb"]
    assert json.loads((raw / "manifest.json").read_bytes())["files"]["models/manifest.json"]["size"] == len(files["models/manifest.json"])


def test_write_models_needs_the_raw_extraction_first(tmp_path):
    with pytest.raises(ExtractError, match="raw extraction"):
        write_models(tmp_path, {})
