import json

import pytest

from fakes import make_game_dir
from tools.extract.errors import ExtractError
from tools.extract.locales import parse_header, parse_table, read_locales
from tools.extract.source import LocalGameSource


def test_parse_header_lists_languages_and_tables():
    from fakes import LOCALE_HEADER
    h = parse_header(LOCALE_HEADER)
    assert [lang["lcid"] for lang in h["languages"]] == [2052, 1033, 1042]
    assert h["languages"][0] == {"lcid": 2052, "name": "简体中文", "code": "zh-CN", "abbr": "zh", "fallback": 1033}
    assert h["tables"] == ["base", "prototype"]


def test_parse_table_keeps_text_column_and_skips_malformed_lines():
    t = parse_table("a\t\t5\tA\r\nb\t#\t0\tB\tB2\r\nbroken\r\n\r\n")
    assert t == {"a": "A", "b": "B\tB2"}


def test_read_locales_writes_one_file_per_present_language(tmp_path):
    src = LocalGameSource(make_game_dir(tmp_path / "game"))
    files = read_locales(src)
    assert sorted(files) == ["locale/1033.json", "locale/2052.json"]  # 1042 is listed but not installed
    zh = json.loads(files["locale/2052.json"])
    assert zh["code"] == "zh-CN"
    assert zh["tables"]["base"]["传送带"] == "传送带"
    assert zh["tables"]["prototype"]["带"] == "左\t右"
    en = json.loads(files["locale/1033.json"])
    assert en["tables"]["prototype"]["制造台 Mk.I"] == "Assembling machine Mk.I"


def test_missing_table_of_present_language_is_an_error(tmp_path):
    src = LocalGameSource(make_game_dir(tmp_path / "game", missing={"Locale/1033/prototype.txt"}))
    with pytest.raises(ExtractError, match="Locale/1033/prototype.txt"):
        read_locales(src)


def test_missing_required_language_is_an_error(tmp_path):
    game = make_game_dir(tmp_path / "game", missing={"Locale/1033/base.txt", "Locale/1033/prototype.txt"})
    with pytest.raises(ExtractError, match="1033"):
        read_locales(LocalGameSource(game))
