import pytest

from fakes import make_game_dir
from tools.extract.errors import ExtractError
from tools.extract.preflight import check_required_files, check_version, parse_version
from tools.extract.source import LocalGameSource


def test_complete_install_passes(tmp_path):
    check_required_files(LocalGameSource(make_game_dir(tmp_path / "g")))


@pytest.mark.parametrize("rel", [
    "DSPGAME_Data/resources.assets",
    "DSPGAME_Data/resources.assets.resS",
    "DSPGAME_Data/sharedassets0.assets.resS",
    "DSPGAME_Data/globalgamemanagers",
    "DSPGAME_Data/globalgamemanagers.assets",
    "DSPGAME_Data/Managed/Assembly-CSharp.dll",
    "Locale/Header.txt",
])
def test_each_required_file_is_named_when_missing(tmp_path, rel):
    src = LocalGameSource(make_game_dir(tmp_path / "g", missing={rel}))
    with pytest.raises(ExtractError, match=rel.replace(".", r"\.")):
        check_required_files(src)


def test_all_missing_files_are_listed_together(tmp_path):
    missing = {"DSPGAME_Data/resources.assets", "DSPGAME_Data/globalgamemanagers"}
    src = LocalGameSource(make_game_dir(tmp_path / "g", missing=missing))
    with pytest.raises(ExtractError) as e:
        check_required_files(src)
    assert all(m in str(e.value) for m in missing)


def test_missing_game_dir_is_reported(tmp_path):
    with pytest.raises(ExtractError, match="DSPGAME_Data"):
        check_required_files(LocalGameSource(tmp_path / "nope"))


@pytest.mark.parametrize("s,v", [("0.10.35", (0, 10, 35)), ("0.10.34.28281", (0, 10, 34, 28281)), (" 0.10.35 ", (0, 10, 35))])
def test_parse_version(s, v):
    assert parse_version(s) == v


@pytest.mark.parametrize("s", ["", "abc", "0.10.x", "1..2"])
def test_unparsable_version_is_an_error(s):
    with pytest.raises(ExtractError, match="version"):
        parse_version(s)


@pytest.mark.parametrize("s", ["0.10.34", "0.10.35", "0.10.34.1", "0.11.0", "1.0"])
def test_supported_versions(s):
    assert check_version(s) == s.strip()


@pytest.mark.parametrize("s", ["0.10.33", "0.10.33.9999", "0.9.27"])
def test_old_versions_are_rejected_with_version_named(s):
    with pytest.raises(ExtractError, match=s.replace(".", r"\.") + r".*0\.10\.34"):
        check_version(s)
