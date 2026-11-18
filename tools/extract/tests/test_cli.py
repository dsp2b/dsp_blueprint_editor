import hashlib
import json
import os

import pytest

from fakes import FakeHost, default_prefabs, make_game_dir, node, reader_factory
from tools.extract import cli
from tools.extract.source import RemoteGameSource


def files_under(root):
    out = {}
    for dp, _, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            out[os.path.relpath(p, root)] = open(p, "rb").read()
    return out


@pytest.fixture
def game(tmp_path):
    return make_game_dir(tmp_path / "game")


def run(game, out, factory=None, extra=()):
    return cli.main(["--game", str(game), "--out", str(out), *extra], reader_factory=factory or reader_factory())


# ---------------------------------------------------------------- failure: nothing written

def test_missing_required_file_exits_nonzero_and_writes_nothing(tmp_path, capsys):
    game = make_game_dir(tmp_path / "game", missing={"DSPGAME_Data/resources.assets.resS"})
    out = tmp_path / "out"
    factory = reader_factory()
    assert run(game, out, factory) != 0
    assert "DSPGAME_Data/resources.assets.resS" in capsys.readouterr().err
    assert not out.exists()
    assert factory.readers == [] or factory.readers[0].calls == [], "nothing is parsed before preflight passes"


def test_old_game_version_exits_nonzero_and_writes_nothing(game, tmp_path, capsys):
    out = tmp_path / "out"
    out.mkdir()
    factory = reader_factory(version="0.10.33")
    assert run(game, out, factory) != 0
    err = capsys.readouterr().err
    assert "0.10.33" in err and "0.10.34" in err
    assert list(out.iterdir()) == []
    assert factory.readers[0].calls == ["version"], "nothing else is read after the version check fails"


def test_uncovered_buildable_items_are_listed_and_exit_nonzero(game, tmp_path, capsys):
    prefabs = default_prefabs()
    prefabs["Entities/Prefabs/assembler-mk-1"] = node(200, "assembler-mk-1")  # lost its SlotConfig
    out = tmp_path / "out"
    assert run(game, out, reader_factory(prefabs=prefabs)) != 0
    err = capsys.readouterr().err
    assert "2303" in err and "制造台 Mk.I" in err and "65" in err
    assert "2001" not in err.split("uncovered", 1)[-1], "covered items are not listed"
    assert not out.exists()


def test_unexpected_failure_mid_extraction_writes_nothing(game, tmp_path):
    out = tmp_path / "out"
    with pytest.raises(RuntimeError):
        run(game, out, reader_factory(fail_on="MIDIProtoSet"))
    assert not out.exists()


# ---------------------------------------------------------------- success: raw layout

@pytest.fixture
def raw(game, tmp_path, capsys):
    out = tmp_path / "out"
    assert run(game, out) == 0
    assert "0.10.35" in capsys.readouterr().out, "the game version is printed"
    return out / "raw" / "0.10.35"


def test_raw_layout(raw):
    names = set(files_under(raw))
    for ps in ("Item", "Recipe", "Tech", "Signal", "Model", "MIDI"):
        assert f"protosets/{ps}ProtoSet.json" in names
    assert {"locale/2052.json", "locale/1033.json", "buildings.json", "manifest.json"} <= names
    assert {"icons/item_recipe/belt-1.png", "icons/item_recipe/gear.png", "icons/tech/1001.png",
            "icons/signal/signal-401.png"} <= names


def test_protosets_carry_game_version(raw):
    for ps in ("Item", "MIDI", "Model"):
        d = json.loads((raw / f"protosets/{ps}ProtoSet.json").read_text())
        assert d["gameVersion"] == "0.10.35"
        assert d["dataArray"]
    midi = json.loads((raw / "protosets/MIDIProtoSet.json").read_text())
    assert midi["dataArray"][0] == {"ID": 1, "Instrument": 1, "PitchRange": 0}


def test_icons_are_pngs_with_source_pixels(raw):
    from PIL import Image
    im = Image.open(raw / "icons/signal/signal-401.png")
    assert im.format == "PNG" and im.mode == "RGBA" and im.getpixel((0, 0)) == (4, 5, 6, 128)


def test_buildings_json_has_models_and_item_upgrade_fields(raw):
    b = json.loads((raw / "buildings.json").read_text())
    assert b["gameVersion"] == "0.10.35"
    assert [m["modelIndex"] for m in b["models"]] == [35, 65], "only models with a SlotConfig, sorted"
    asm = b["models"][1]
    assert asm["selectSize"] == [4.2, 4.6, 4.2] and asm["selectCenter"] == [0.0, 2.3, 0.0]
    assert len(asm["slotPoses"]) == 1 and len(asm["insertPoses"]) == 1
    assert asm["tint"] == [1.0, 0.65963, 0.3066038, 1.0]
    assert asm["work"]["assemblerSpeed"] == 7500
    belt = b["models"][0]
    assert belt["tint"] is None and belt["work"]["beltSpeed"] == 1
    items = {i["id"]: i for i in b["items"]}
    assert sorted(items) == [1131, 2001, 2303], "every CanBuild item"
    assert items[2001] == {"id": 2001, "name": "传送带", "grade": 1, "upgrades": [2001, 2002, 2003],
                           "buildIndex": 301, "modelIndex": 35, "modelCount": 1}


def test_manifest_lists_every_file_with_size_and_hash(raw):
    m = json.loads((raw / "manifest.json").read_text())
    assert m["gameVersion"] == "0.10.35"
    on_disk = files_under(raw)
    del on_disk["manifest.json"]
    assert m["files"] == {k: {"size": len(v), "sha256": hashlib.sha256(v).hexdigest()} for k, v in sorted(on_disk.items())}
    assert list(m["files"]) == sorted(m["files"])
    cov = {r["item"]: r for r in m["coverage"]["items"]}
    assert cov[2001]["status"] == "no-static-model" and cov[2303]["status"] == "selection-box"
    assert m["coverage"]["uncovered"] == []
    assert m["missingIcons"] == []


def test_missing_icons_are_reported_not_fatal(game, tmp_path):
    from fakes import default_icons
    icons = default_icons()
    del icons["Icons/Tech/1001"]
    out = tmp_path / "out"
    assert run(game, out, reader_factory(icons=icons)) == 0
    m = json.loads((out / "raw/0.10.35/manifest.json").read_text())
    assert m["missingIcons"] == [{"category": "tech", "iconPath": "Icons/Tech/1001"}]


def test_rerun_is_byte_identical_and_order_independent(game, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert run(game, a) == 0
    assert run(game, b, reader_factory(reverse_models=True)) == 0
    fa, fb = files_under(a), files_under(b)
    assert fa.keys() == fb.keys()
    assert fa["raw/0.10.35/buildings.json"] == fb["raw/0.10.35/buildings.json"]
    c = tmp_path / "c"
    assert run(game, c) == 0
    assert files_under(c) == fa


def test_rerun_replaces_previous_output_of_same_version(game, tmp_path):
    out = tmp_path / "out"
    assert run(game, out) == 0
    stale = out / "raw/0.10.35/icons/tech/stale.png"
    stale.write_bytes(b"x")
    assert run(game, out) == 0
    assert not stale.exists()
    assert sorted(os.listdir(out / "raw")) == ["0.10.35"], "no staging leftovers"


# ---------------------------------------------------------------- arguments and subcommands

def test_requires_a_source_and_out(game, tmp_path):
    with pytest.raises(SystemExit) as e:
        cli.main(["--out", str(tmp_path / "o")], reader_factory=reader_factory())
    assert e.value.code != 0
    with pytest.raises(SystemExit):
        cli.main(["--game", str(game)], reader_factory=reader_factory())
    with pytest.raises(SystemExit):
        cli.main(["--game", str(game), "--remote", "h", "--out", "o"], reader_factory=reader_factory())


def test_subcommand_packages_are_discovered(monkeypatch):
    names = [m.__name__ for m in cli.discover_subcommand_modules()]
    assert names == ["tools.extract.convert", "tools.extract.models", "tools.extract.update"]


def test_registered_subcommand_is_dispatched(monkeypatch, tmp_path):
    seen = {}

    def register(sub):
        p = sub.add_parser("probe")
        p.add_argument("--x")
        p.set_defaults(func=lambda args, ctx: seen.setdefault("x", args.x) and 0)

    import tools.extract.models as models
    monkeypatch.setattr(models, "register", register)
    assert cli.main(["probe", "--x", "7"], reader_factory=reader_factory()) == 0
    assert seen == {"x": "7"}


def test_remote_source_is_cleaned_up_when_extraction_fails(game, tmp_path):
    hosts = []

    def host_factory(name):
        h = FakeHost(game, tmp_path / "remote-temp")
        hosts.append(h)
        return h

    class Touching:
        """Reader that performs a byte-range read (creating the remote temp dir) and then fails."""

        def __init__(self, source, log=None):
            assert isinstance(source, RemoteGameSource)
            self.source = source

        def version(self):
            self.source.read("DSPGAME_Data/globalgamemanagers", 0, 4)
            return "0.10.33"

    out = tmp_path / "out"
    rc = cli.main(["--remote", "rdp-ssh", "--out", str(out)], reader_factory=Touching, remote_host_factory=host_factory)
    assert rc != 0
    assert hosts[0].created and not hosts[0].created[0].exists()
    assert list((tmp_path / "remote-temp").iterdir()) == []
    assert not out.exists()


def test_remote_end_to_end_with_fake_host(game, tmp_path):
    out = tmp_path / "out"
    hosts = []

    def host_factory(name):
        hosts.append(FakeHost(game, tmp_path / "remote-temp"))
        return hosts[0]

    rc = cli.main(["--remote", "rdp-ssh", "--out", str(out)], reader_factory=reader_factory(),
                  remote_host_factory=host_factory)
    assert rc == 0
    local = tmp_path / "local"
    assert run(game, local) == 0
    assert files_under(out) == files_under(local), "remote and local sources yield identical output"
    assert list((tmp_path / "remote-temp").iterdir()) == []
