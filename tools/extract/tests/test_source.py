import pytest

from tools.extract.source import LocalGameSource, RemoteGameSource
from fakes import FakeHost, make_game_dir


@pytest.fixture
def game(tmp_path):
    root = make_game_dir(tmp_path / "game")
    (root / "DSPGAME_Data/resources.assets.resS").write_bytes(bytes(range(256)) * 4)
    return root


def remote(game, tmp_path, **kw):
    host = FakeHost(game, tmp_path / "remote-temp", **kw)
    return RemoteGameSource(host, "C:/Games/DSP"), host


def test_local_read_whole_and_range(game):
    src = LocalGameSource(game)
    assert src.read("DSPGAME_Data/resources.assets.resS", 10, 3) == bytes([10, 11, 12])
    assert src.read("DSPGAME_Data/globalgamemanagers") == b"fake:DSPGAME_Data/globalgamemanagers"
    assert src.size("DSPGAME_Data/resources.assets.resS") == 1024
    assert src.size("DSPGAME_Data/nope") is None
    assert "Assembly-CSharp.dll" in src.listdir("DSPGAME_Data/Managed")
    assert src.listdir("DSPGAME_Data/nothing") is None


def test_local_short_read_is_an_error(game):
    src = LocalGameSource(game)
    with pytest.raises(Exception, match="short read"):
        src.read("DSPGAME_Data/resources.assets.resS", 1020, 10)


@pytest.mark.parametrize("bad", ["../etc/passwd", "/abs/path", "DSPGAME_Data/../../x", "C:/x", ""])
def test_paths_must_stay_inside_game_dir(game, tmp_path, bad):
    src = LocalGameSource(game)
    with pytest.raises(ValueError):
        src.read(bad)
    rsrc, _ = remote(game, tmp_path)
    with pytest.raises(ValueError):
        rsrc.read_ranges([(bad, 0, 1)])


def test_remote_reads_byte_ranges_in_one_batch(game, tmp_path):
    src, host = remote(game, tmp_path)
    with src:
        got = src.read_ranges([
            ("DSPGAME_Data/resources.assets.resS", 0, 4),
            ("DSPGAME_Data/resources.assets.resS", 300, 2),
            ("DSPGAME_Data/globalgamemanagers", 0, 4),
        ])
        assert got == [bytes([0, 1, 2, 3]), bytes([44, 45]), b"fake"]
        assert src.read("DSPGAME_Data/resources.assets.resS", 255, 2) == bytes([255, 0])
        assert src.read("DSPGAME_Data/globalgamemanagers") == b"fake:DSPGAME_Data/globalgamemanagers"
    extracts = [c for c in host.calls if c[0] == "extract_ranges"]
    assert len(extracts[0][2]) == 3, "the first three ranges go out as a single remote call"


def test_remote_size_and_listdir_use_directory_listing(game, tmp_path):
    src, host = remote(game, tmp_path)
    with src:
        assert src.size("DSPGAME_Data/resources.assets.resS") == 1024
        assert src.size("DSPGAME_Data/globalgamemanagers.assets") == len(b"fake:DSPGAME_Data/globalgamemanagers.assets")
        assert src.size("DSPGAME_Data/missing.assets") is None
        assert src.size("NoSuchDir/file") is None
        assert sorted(src.listdir("DSPGAME_Data/Managed")) == ["Assembly-CSharp.dll", "UnityEngine.CoreModule.dll"]
    lists = [c for c in host.calls if c[0] == "list_dir"]
    assert [c[1] for c in lists].count("DSPGAME_Data") == 1, "directory listings are cached"


def test_remote_temp_dir_deleted_on_close(game, tmp_path):
    src, host = remote(game, tmp_path)
    with src:
        src.read("DSPGAME_Data/resources.assets.resS", 0, 1)
        assert len(host.created) == 1 and host.created[0].exists()
    assert not host.created[0].exists()
    assert list((tmp_path / "remote-temp").iterdir()) == []


def test_remote_temp_dir_deleted_when_range_read_fails(game, tmp_path):
    src, host = remote(game, tmp_path, fail_extract=True)
    with pytest.raises(RuntimeError, match="remote range read failed"):
        with src:
            src.read("DSPGAME_Data/resources.assets.resS", 0, 1)
    assert host.created and not host.created[0].exists()
    assert list((tmp_path / "remote-temp").iterdir()) == []


def test_remote_temp_dir_deleted_when_caller_fails_later(game, tmp_path):
    src, host = remote(game, tmp_path)
    with pytest.raises(KeyError):
        with src:
            src.read("DSPGAME_Data/resources.assets.resS", 0, 1)
            raise KeyError("later failure")
    assert host.created and not host.created[0].exists()


def test_remote_without_range_reads_creates_no_temp_dir(game, tmp_path):
    src, host = remote(game, tmp_path)
    with src:
        src.size("DSPGAME_Data/resources.assets")
    assert host.created == []
    assert not any(c[0] == "remove_temp_dir" for c in host.calls)


def test_remote_close_is_idempotent(game, tmp_path):
    src, host = remote(game, tmp_path)
    src.read("DSPGAME_Data/resources.assets.resS", 0, 1)
    src.close()
    src.close()
    assert [c[0] for c in host.calls].count("remove_temp_dir") == 1


def test_remote_has_no_local_path(game, tmp_path):
    src, _ = remote(game, tmp_path)
    assert src.local_path("DSPGAME_Data/resources.assets") is None
    assert LocalGameSource(game).local_path("DSPGAME_Data/resources.assets") == game / "DSPGAME_Data/resources.assets"


class LosesMkdirOutput(FakeHost):
    """The remote dir gets created but the call reporting it fails (dropped link, Ctrl-C)."""

    def make_temp_dir(self, name):
        super().make_temp_dir(name)
        raise RuntimeError("connection dropped after mkdir")


def test_remote_temp_dir_removed_even_if_creation_reply_is_lost(game, tmp_path):
    host = LosesMkdirOutput(game, tmp_path / "remote-temp")
    src = RemoteGameSource(host, "C:/Games/DSP")
    with pytest.raises(RuntimeError, match="connection dropped"):
        with src:
            src.read("DSPGAME_Data/resources.assets.resS", 0, 1)
    assert list((tmp_path / "remote-temp").iterdir()) == []


class CleanupFails(FakeHost):
    def remove_temp_dir(self, name):
        self.calls.append(("remove_temp_dir", name))
        raise RuntimeError("cleanup also failed")


def test_cleanup_failure_does_not_hide_the_original_error(game, tmp_path):
    logs = []
    host = CleanupFails(game, tmp_path / "remote-temp", fail_extract=True)
    src = RemoteGameSource(host, "C:/Games/DSP", log=logs.append)
    with pytest.raises(RuntimeError, match="remote range read failed"):
        with src:
            src.read("DSPGAME_Data/resources.assets.resS", 0, 1)
    assert any("cleanup also failed" in m for m in logs)


def test_cleanup_failure_is_raised_when_nothing_else_failed(game, tmp_path):
    host = CleanupFails(game, tmp_path / "remote-temp")
    src = RemoteGameSource(host, "C:/Games/DSP")
    with pytest.raises(RuntimeError, match="cleanup also failed"):
        with src:
            src.read("DSPGAME_Data/resources.assets.resS", 0, 1)


@pytest.mark.parametrize("bad", ["a\tb", "a\nb", "a\rb"])
def test_relative_paths_reject_control_characters(bad):
    from tools.extract.source import check_rel
    with pytest.raises(ValueError):
        check_rel(bad)
