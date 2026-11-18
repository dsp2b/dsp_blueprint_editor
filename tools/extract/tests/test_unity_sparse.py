import struct

import pytest

from tools.extract import unity
from tools.extract.errors import ExtractError
from tools.extract.source import GameSource, OpsctlHost, _win_to_opsctl
from tools.extract.unity import SparseCache, SparseFile, serialized_data_offset

DATA = bytes((i * 7) % 251 for i in range(3 * (1 << 20) + 123))


class CountingSource(GameSource):
    def __init__(self, data=DATA):
        self.data, self.batches = data, []

    def read_ranges(self, ranges):
        self.batches.append(list(ranges))
        return [self.data[o:o + n] for _, o, n in ranges]

    def size(self, path):
        return len(self.data)


def test_prefetched_ranges_are_served_without_more_reads():
    src = CountingSource()
    cache = SparseCache(src, "f", len(DATA))
    plan = cache.plan([(100, 200), (250, 300), (2_000_000, 2_000_010)])
    assert plan == [("f", 100, 200), ("f", 2_000_000, 10)], "ranges closer than MERGE_GAP are merged"
    cache.fill(plan, src.read_ranges(plan))
    src.batches.clear()
    assert cache.read(120, 50) == DATA[120:170]
    assert cache.read(2_000_000, 10) == DATA[2_000_000:2_000_010]
    assert src.batches == [] and cache.misses == 0


def test_plan_skips_what_is_cached():
    src = CountingSource()
    cache = SparseCache(src, "f", len(DATA))
    cache.fill([("f", 0, 1000)], [DATA[:1000]])
    assert cache.plan([(500, 1500)]) == [("f", 1000, 500)]
    assert cache.plan([(10, 20)]) == []


def test_miss_fetches_aligned_block_and_returns_correct_bytes():
    src = CountingSource()
    cache = SparseCache(src, "f", len(DATA))
    assert cache.read(unity.MISS_BLOCK + 5, 10) == DATA[unity.MISS_BLOCK + 5:unity.MISS_BLOCK + 15]
    assert cache.misses == 1
    assert src.batches == [[("f", unity.MISS_BLOCK, unity.MISS_BLOCK)]]


def test_reads_spanning_cached_and_uncached_parts():
    src = CountingSource()
    cache = SparseCache(src, "f", len(DATA))
    cache.fill([("f", 10, 10)], [DATA[10:20]])
    assert cache.read(0, 40) == DATA[0:40]
    assert cache.read(len(DATA) - 5, 100) == DATA[-5:], "reads are clipped at end of file"
    assert cache.read(len(DATA), 10) == b""


def test_sparse_file_behaves_like_a_file():
    f = SparseFile(SparseCache(CountingSource(), "f", len(DATA)))
    f.seek(1000)
    assert f.read(4) == DATA[1000:1004] and f.tell() == 1004
    f.seek(-3, 2)
    assert f.read() == DATA[-3:]
    f.seek(2, 0)
    f.seek(3, 1)
    buf = bytearray(4)
    assert f.readinto(buf) == 4 and bytes(buf) == DATA[5:9]


def test_serialized_data_offset_reads_v22_header():
    head = struct.pack(">IIII", 0, 0, 22, 0) + bytes(4) + struct.pack(">Iqqq", 0x3b79ae, 0x1ab20638, 0x3b79e0, 0)
    assert serialized_data_offset(head) == 3897824
    old = struct.pack(">IIII", 100, 200, 17, 4096) + bytes(32)
    assert serialized_data_offset(old) == 4096


def test_opsctl_paths():
    assert _win_to_opsctl("C:\\Users\\me\\AppData\\Local\\Temp\\dsp-extract-1") == "/C:/Users/me/AppData/Local/Temp/dsp-extract-1"


def test_opsctl_host_refuses_to_delete_anything_but_its_temp_dirs(monkeypatch):
    host = OpsctlHost("asset")
    calls = []
    monkeypatch.setattr(host, "_ps", lambda script, what: calls.append(script) or ["@@GONE"])
    for bad in ("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Dyson Sphere Program", "C:\\Users\\me", "C:\\"):
        with pytest.raises(ExtractError, match="refusing"):
            host.remove_temp_dir(bad)
    assert calls == []
    host.remove_temp_dir("C:\\Users\\me\\AppData\\Local\\Temp\\dsp-extract-abc")
    assert len(calls) == 1 and "dsp-extract-abc" in calls[0]


def test_opsctl_host_parses_listing(monkeypatch):
    host = OpsctlHost("asset")
    monkeypatch.setattr(host, "_ps", lambda s, w: ["noise", "@@F\t12\tresources.assets", "@@D\t\tManaged", "@@END"])
    assert host.list_dir("C:/g", "DSPGAME_Data") == {"resources.assets": 12, "Managed": None}
    monkeypatch.setattr(host, "_ps", lambda s, w: ["@@NONE"])
    assert host.list_dir("C:/g", "nope") is None
    monkeypatch.setattr(host, "_ps", lambda s, w: ["@@F\t12\tresources.assets"])
    with pytest.raises(ExtractError, match="truncated"):
        host.list_dir("C:/g", "DSPGAME_Data")


def test_opsctl_failure_is_reported(monkeypatch):
    import subprocess
    host = OpsctlHost("asset")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 3, b"", b"NEEDS AUTHORIZATION"))
    with pytest.raises(ExtractError, match="NEEDS AUTHORIZATION"):
        host.make_temp_dir()


def test_game_paths_are_quoted_for_powershell():
    from tools.extract.source import _ps_literal
    assert _ps_literal("C:/Bob's Games") == "'C:/Bob''s Games'"
