"""`update`: one command regenerates all data and models after a game update (raw + models + convert)."""
import json

from fakes import make_game_dir, reader_factory
from tools.extract import cli
import tools.extract.models.export as export

FAKE_MODELS = {"models/65.glb": b"glTF-65", "models/belt/belt-mk1.glb": b"glTF-belt", "models/manifest.json": b"{}"}


def test_update_runs_extraction_models_and_convert_in_one_source_session(tmp_path, monkeypatch, capsys):
    opened = []
    monkeypatch.setattr(export, "export_models", lambda game, models, log=None: dict(FAKE_MODELS))
    monkeypatch.setattr("tools.extract.models.make_game", lambda reader, source, log: object())
    factory = reader_factory()

    def counting(source, log=None):
        opened.append(source)
        return factory(source, log)

    game, out = make_game_dir(tmp_path / "game"), tmp_path / "out"
    site, go = tmp_path / "site", tmp_path / "go"
    rc = cli.main(["--game", str(game), "--out", str(out), "update", "--skip-validate",
                   "--models", str(site), "--go-data", str(go)], reader_factory=counting)
    assert rc == 0
    raw = out / "raw" / "0.10.35"
    assert (raw / "buildings.json").is_file() and (raw / "models/65.glb").read_bytes() == b"glTF-65"
    assert "models/belt/belt-mk1.glb" in json.loads((raw / "manifest.json").read_text())["files"]
    assert (site / "belt/belt-mk1.glb").read_bytes() == b"glTF-belt"
    assert (go / "itemProtoSet.json").is_file()
    assert len({id(s) for s in opened}) == 1, "the game is opened once for both the raw data and the models"
    assert "0.10.35" in capsys.readouterr().out


def test_update_needs_a_destination_before_reading_the_game(tmp_path, capsys):
    factory = reader_factory()
    rc = cli.main(["--game", str(make_game_dir(tmp_path / "game")), "--out", str(tmp_path / "out"), "update"],
                  reader_factory=factory)
    assert rc != 0 and "destination" in capsys.readouterr().err
    assert factory.readers == [] and not (tmp_path / "out").exists()
