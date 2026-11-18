import json

import pytest

from convert_fakes import make_raw
from tools.extract import cli


def run(*args):
    return cli.main(list(args))


@pytest.fixture
def raw(tmp_path):
    return make_raw(tmp_path / "out")


def test_convert_needs_a_destination(raw, capsys):
    assert run("convert", "--raw", str(raw)) != 0
    assert "destination" in capsys.readouterr().err


def test_convert_missing_raw_dir_fails(tmp_path, capsys):
    assert run("convert", "--raw", str(tmp_path / "nope"), "--go-data", str(tmp_path / "go")) != 0
    assert "nope" in capsys.readouterr().err


def test_convert_raw_defaults_to_latest_version_under_out(tmp_path):
    make_raw(tmp_path / "out", "0.10.34")
    make_raw(tmp_path / "out", "0.10.35")
    assert run("--out", str(tmp_path / "out"), "convert", "--go-data", str(tmp_path / "go")) == 0
    assert (tmp_path / "go" / "itemProtoSet.json").exists()


def test_convert_all_targets(raw, tmp_path, capsys):
    go, fe, data, loc, icons = (tmp_path / n for n in ("go", "fe", "data", "loc", "icons"))
    loc.mkdir()
    (loc / "zh.json").write_text(json.dumps({"UI确定": "旧"}, ensure_ascii=False), encoding="utf-8")
    rc = run("convert", "--raw", str(raw), "--go-data", str(go), "--frontend-data", str(fe),
             "--preview-data", str(data), "--locales", str(loc), "--icons", str(icons))
    assert rc == 0
    for n in ("item", "recipe", "tech", "signal"):
        assert json.loads((go / f"{n}ProtoSet.json").read_text(encoding="utf-8"))["Type"] == n.capitalize() + "ProtoSet"
    assert json.loads((fe / "itemProtoSet.json").read_text(encoding="utf-8"))["DataArray"][0]["Proto"]["IconPath"] \
        == "icons/item_recipe/iron-ore"
    for n in ("itemsData", "recipesData", "midi", "signalIconsData", "techIconsData", "building"):
        assert (data / f"{n}.ts").exists(), n
    assert json.loads((loc / "zh.json").read_text(encoding="utf-8"))["UI确定"] == "确定"
    assert json.loads((loc / "en.json").read_text(encoding="utf-8"))["铁矿"] == "Iron Ore"
    assert (icons / "item_recipe" / "iron-ore.png").exists() and (icons / "tech" / "1.png").exists()
    assert (icons / "signal" / "signal-501.png").exists()
    out = capsys.readouterr().out
    assert "0.10.35" in out


def test_convert_compat_report_against_existing_sibling_files(raw, tmp_path, capsys):
    go = tmp_path / "go"
    assert run("convert", "--raw", str(raw), "--go-data", str(go)) == 0
    p = go / "itemProtoSet.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    d["DataArray"][0]["Proto"]["Grade"] = 999
    d["DataArray"].append({"Name": "x", "ID": 7, "SID": "", "Proto": {}})
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    report = tmp_path / "report.json"
    capsys.readouterr()
    assert run("convert", "--raw", str(raw), "--go-data", str(go), "--report", str(report)) == 0
    text = capsys.readouterr().out
    assert "Grade" in text and "removed" in text
    rep = json.loads(report.read_text(encoding="utf-8"))
    assert rep["itemProtoSet.json"]["removed"] == [7]
    assert rep["itemProtoSet.json"]["changed"][0]["field"] == "Grade"
    # the existing file was replaced by the regenerated one
    assert json.loads(p.read_text(encoding="utf-8"))["DataArray"][0]["Proto"]["Grade"] == 0


def test_convert_is_idempotent(raw, tmp_path):
    args = ["convert", "--raw", str(raw), "--go-data", str(tmp_path / "go"), "--preview-data", str(tmp_path / "d")]
    run(*args)
    first = {p.name: p.read_bytes() for p in (tmp_path / "d").iterdir()}
    run(*args)
    assert {p.name: p.read_bytes() for p in (tmp_path / "d").iterdir()} == first
