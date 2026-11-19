import json
from tools.extract import cli
from tools.extract.preflight import REQUIRED_FILES

import tools.extract.models as models_cmd
from test_models_export import MODELS, game


class FakeReader:
    closed = False

    def version(self):
        return "0.10.35"

    def close(self):
        FakeReader.closed = True


def make_install(root):
    for rel in REQUIRED_FILES:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    return root


def run(tmp_path, monkeypatch, *extra, out=None):
    monkeypatch.setattr(models_cmd, "make_game", lambda reader, source, log: game())
    out = out or tmp_path / "out"
    return cli.main(["--game", str(make_install(tmp_path / "game")), "--out", str(out), "models", *extra],
                    reader_factory=lambda source, log: FakeReader())


def seed_raw(out, buildings=MODELS):
    raw = out / "raw/0.10.35"
    raw.mkdir(parents=True)
    (raw / "buildings.json").write_text(json.dumps({"models": buildings}))
    (raw / "manifest.json").write_text(json.dumps({"gameVersion": "0.10.35", "files": {}}))
    return raw


def test_models_command_validates_and_lands_files_in_raw_and_manifest(tmp_path, monkeypatch, capsys):
    raw = seed_raw(tmp_path / "out")
    assert run(tmp_path, monkeypatch) == 0
    assert FakeReader.closed
    assert (raw / "models/65.glb").is_file() and (raw / "models/sorter/sorter-mk4-lod2.glb").is_file()
    files = json.loads((raw / "manifest.json").read_text())["files"]
    assert "models/belt/belt-mk1.glb" in files and "models/manifest.json" in files
    assert "wrote 14 GLB files" in capsys.readouterr().out


def test_models_command_rerun_is_byte_identical(tmp_path, monkeypatch):
    raw = seed_raw(tmp_path / "out")
    run(tmp_path, monkeypatch)
    first = {p.relative_to(raw): p.read_bytes() for p in raw.rglob("*") if p.is_file()}
    run(tmp_path, monkeypatch)
    assert {p.relative_to(raw): p.read_bytes() for p in raw.rglob("*") if p.is_file()} == first


def test_models_command_fails_without_raw_extraction(tmp_path, monkeypatch, capsys):
    assert run(tmp_path, monkeypatch) == 1
    assert "run the raw extraction" in capsys.readouterr().err
    assert not (tmp_path / "out/raw/0.10.35/models").exists()


def test_models_command_validation_failure_leaves_raw_untouched(tmp_path, monkeypatch, capsys):
    raw = seed_raw(tmp_path / "out")
    before = (raw / "manifest.json").read_bytes()
    monkeypatch.setattr("tools.extract.models.validation.validate_glbs",
                        lambda paths: [{"file": str(paths[0]), "errors": 1, "warnings": 0, "messages": ["X"]}])
    assert run(tmp_path, monkeypatch) == 1
    assert "glTF validation failed" in capsys.readouterr().err
    assert not (raw / "models").exists() and (raw / "manifest.json").read_bytes() == before
    assert not [p for p in raw.iterdir() if p.name.startswith(".")]
