"""Read-only access to a DSP install, either on this machine or on a remote one via opsctl.

Paths are always relative to the game root (the directory holding DSPGAME_Data/ and Locale/) and
use forward slashes. Nothing here ever writes inside the game directory.
"""
import base64
import gzip
import posixpath
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from .errors import ExtractError

Range = Tuple[str, int, int]  # (relative path, offset, length)

DEFAULT_REMOTE_GAME_DIR = "C:/Program Files (x86)/Steam/steamapps/common/Dyson Sphere Program"
REMOTE_TEMP_PREFIX = "dsp-extract-"


def check_rel(path: str) -> str:
    """Reject anything that could escape the game directory."""
    if not isinstance(path, str) or not path or "\\" in path or path.startswith("/") \
            or any(ord(c) < 0x20 for c in path) \
            or re.match(r"^[A-Za-z]:", path) or any(p in ("", ".", "..") for p in path.split("/")):
        raise ValueError(f"invalid game-relative path: {path!r}")
    return path


class GameSource:
    """Read-only view of a game install.

    read(path, offset, length) is the primitive; read_ranges() batches many reads into one round
    trip (what the remote source needs); local_path() exposes a real file when there is one.
    """

    def read(self, path: str, offset: int = 0, length: Optional[int] = None) -> bytes:
        if length is None:
            size = self.size(path)
            if size is None:
                raise ExtractError(f"missing game file: {path}")
            length = size - offset
        return self.read_ranges([(path, offset, length)])[0]

    def read_ranges(self, ranges: Sequence[Range]) -> List[bytes]:
        raise NotImplementedError

    def size(self, path: str) -> Optional[int]:
        raise NotImplementedError

    def listdir(self, path: str) -> Optional[List[str]]:
        raise NotImplementedError

    def local_path(self, path: str) -> Optional[Path]:
        return None

    def describe(self) -> str:
        raise NotImplementedError

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.close()
            return False
        # 已有异常在传播时，清理失败（多半是同一条断开的连接）只记录，不覆盖原始错误
        try:
            self.close()
        except Exception as e:  # noqa: BLE001
            self._log_cleanup_failure(e)
        return False

    def _log_cleanup_failure(self, e):
        print(f"warning: cleanup failed: {e}", file=sys.stderr, flush=True)


class LocalGameSource(GameSource):
    def __init__(self, root):
        self.root = Path(root)

    def _p(self, path):
        return self.root / check_rel(path)

    def read_ranges(self, ranges):
        out = []
        for path, offset, length in ranges:
            p = self._p(path)
            if not p.is_file():
                raise ExtractError(f"missing game file: {path}")
            with open(p, "rb") as f:
                f.seek(offset)
                data = f.read(length)
            if len(data) != length:
                raise ExtractError(f"short read: {path} @{offset}+{length} (got {len(data)})")
            out.append(data)
        return out

    def size(self, path):
        p = self._p(path)
        return p.stat().st_size if p.is_file() else None

    def listdir(self, path):
        p = self._p(path)
        return sorted(c.name for c in p.iterdir()) if p.is_dir() else None

    def local_path(self, path):
        p = self._p(path)
        return p if p.is_file() else None

    def describe(self):
        return f"local game dir {self.root}"


class RemoteGameSource(GameSource):
    """Byte-range reads from a game install on another machine.

    `host` performs the remote operations (OpsctlHost in production, a fake in tests). A scratch
    directory is created on the remote side on first use and deleted by close(), which the
    context manager guarantees on success and on failure.
    """

    def __init__(self, host, game_dir: str = DEFAULT_REMOTE_GAME_DIR, log=None):
        self.host = host
        self.game_dir = game_dir
        self.log = log or (lambda msg: None)
        self._listings: Dict[str, Optional[Dict[str, Optional[int]]]] = {}
        # 名字先在本地定好再创建：创建的回包丢了（断线、Ctrl-C）也知道该删哪个目录
        self._temp_name: Optional[str] = None
        self._temp: Optional[str] = None
        self._removing: Optional[str] = None

    def _listing(self, rel_dir: str):
        if rel_dir not in self._listings:
            self._listings[rel_dir] = self.host.list_dir(self.game_dir, rel_dir)
        return self._listings[rel_dir]

    def _entry(self, path):
        parent, name = posixpath.split(check_rel(path))
        listing = self._listing(parent)
        if listing is None:
            return False, None
        if name in listing:
            return True, listing[name]
        lowered = {k.lower(): v for k, v in listing.items()}  # Windows paths are case-insensitive
        if name.lower() in lowered:
            return True, lowered[name.lower()]
        return False, None

    def size(self, path):
        exists, size = self._entry(path)
        return size if exists else None

    def listdir(self, path):
        listing = self._listing(check_rel(path))
        return None if listing is None else sorted(listing)

    def read_ranges(self, ranges):
        ranges = [(check_rel(p), int(o), int(n)) for p, o, n in ranges]
        if not ranges:
            return []
        for p, o, n in ranges:
            size = self.size(p)
            if size is None:
                raise ExtractError(f"missing game file: {p}")
            if o < 0 or n < 0 or o + n > size:
                raise ExtractError(f"short read: {p} @{o}+{n} (file is {size} bytes)")
        if self._temp is None:
            self._temp_name = REMOTE_TEMP_PREFIX + uuid.uuid4().hex
            self._temp = self.host.make_temp_dir(self._temp_name)
            self.log(f"remote scratch dir: {self._temp}")
        blob = self.host.extract_ranges(self.game_dir, self._temp, ranges)
        want = sum(n for _, _, n in ranges)
        if len(blob) != want:
            raise ExtractError(f"remote range read returned {len(blob)} bytes, expected {want}")
        out, pos = [], 0
        for _, _, n in ranges:
            out.append(blob[pos:pos + n])
            pos += n
        return out

    def describe(self):
        return f"remote game dir {self.game_dir}"

    def close(self):
        name, self._temp_name, self._temp = self._temp_name, None, None
        if name is not None:
            self._removing = name
            self.host.remove_temp_dir(name)
            self.log(f"removed remote scratch dir: {name}")

    def _log_cleanup_failure(self, e):
        self.log(f"warning: could not remove remote scratch dir %TEMP%\\{self._removing}: {e}")


# ---------------------------------------------------------------- opsctl transport

_PS_QUOTES = "'\u2018\u2019\u201a\u201b"  # PowerShell treats all of these as single quotes


def _ps_literal(s: str) -> str:
    return "'" + "".join(c + c if c in _PS_QUOTES else c for c in s) + "'"


_TEMP_NAME = re.compile("^" + re.escape(REMOTE_TEMP_PREFIX) + "[0-9A-Za-z]+$")


def _check_temp_name(name: str) -> str:
    if not isinstance(name, str) or not _TEMP_NAME.match(name):
        raise ExtractError(f"refusing to touch unexpected remote temp dir {name!r}")
    return name


def _win_to_opsctl(path: str) -> str:
    """C:\\Users\\x -> /C:/Users/x (the form `opsctl cp` expects after `asset:`)."""
    return "/" + path.replace("\\", "/").lstrip("/")


_RANGES_PS = r"""
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$game = __GAME__; $tmp = __TMP__
$list = [IO.File]::ReadAllLines((Join-Path $tmp 'ranges.txt'))
$out = [IO.File]::Create((Join-Path $tmp 'ranges.bin.gz'))
$total = [int64]0
try {
  $gz = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionMode]::Compress)
  $buf = New-Object byte[] 1048576
  foreach ($line in $list) {
    if (-not $line) { continue }
    $p = $line.Split("`t")
    $fs = [IO.File]::Open((Join-Path $game $p[0]), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      [void]$fs.Seek([int64]$p[1], [IO.SeekOrigin]::Begin)
      $left = [int64]$p[2]
      while ($left -gt 0) {
        $n = $fs.Read($buf, 0, [int][Math]::Min([int64]$buf.Length, $left))
        if ($n -le 0) { throw ('short read: ' + $line) }
        $gz.Write($buf, 0, $n); $left -= $n; $total += $n
      }
    } finally { $fs.Dispose() }
  }
  $gz.Dispose()
} finally { $out.Dispose() }
"@@OK`t$total"
"""

_LIST_PS = r"""
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$p = Join-Path __GAME__ __REL__
if (-not (Test-Path -LiteralPath $p -PathType Container)) { '@@NONE'; exit 0 }
foreach ($c in Get-ChildItem -LiteralPath $p -Force) {
  if ($c.PSIsContainer) { "@@D`t`t" + $c.Name } else { "@@F`t" + $c.Length + "`t" + $c.Name }
}
'@@END'
"""

_MKTEMP_PS = r"""
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$d = Join-Path ([IO.Path]::GetTempPath()) __NAME__
[void](New-Item -ItemType Directory -Path $d)
"@@DIR`t" + $d
"""

_RMTEMP_PS = r"""
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
$d = Join-Path ([IO.Path]::GetTempPath()) __NAME__
if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
if (Test-Path -LiteralPath $d) { throw ('still exists: ' + $d) }
'@@GONE'
"""


class OpsctlHost:
    """Remote operations on a Windows machine through `opsctl exec` / `opsctl cp`.

    Game files are only ever opened with FileAccess.Read; scratch files live in a directory
    under the remote user's %TEMP% named dsp-extract-<guid>.
    """

    def __init__(self, asset: str, opsctl: str = "opsctl", log=None):
        self.asset = asset
        self.opsctl = opsctl
        self.log = log or (lambda msg: None)

    def _run(self, args, what):
        r = subprocess.run([self.opsctl, *args], capture_output=True)
        if r.returncode != 0:
            err = (r.stderr or b"").decode("utf-8", "replace").strip()[-2000:]
            raise ExtractError(f"remote {what} failed (opsctl exit {r.returncode}): {err}")
        return r.stdout.decode("utf-8", "replace")

    def _ps(self, script, what):
        script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8\n" + script
        enc = base64.b64encode(script.encode("utf-16-le")).decode()
        out = self._run(["exec", self.asset, "--", f"powershell -NoProfile -NonInteractive -EncodedCommand {enc}"], what)
        return [line.rstrip("\r") for line in out.splitlines()]

    def _cp(self, src, dst, what):
        self._run(["cp", src, dst], what)

    def list_dir(self, game_dir, rel):
        lines = self._ps(_LIST_PS.replace("__GAME__", _ps_literal(game_dir)).replace("__REL__", _ps_literal(rel or ".")),
                         f"listing of {rel or '.'}")
        if "@@NONE" in lines:
            return None
        if "@@END" not in lines:
            raise ExtractError(f"remote listing of {rel} was truncated")
        out = {}
        for line in lines:
            if line.startswith("@@F\t") or line.startswith("@@D\t"):
                kind, size, name = line.split("\t", 2)
                out[name] = int(size) if kind == "@@F" else None
        return out

    def make_temp_dir(self, name):
        """Create %TEMP%\\<name> on the remote side and return its full path."""
        lines = self._ps(_MKTEMP_PS.replace("__NAME__", _ps_literal(_check_temp_name(name))), "temp dir creation")
        for line in lines:
            if line.startswith("@@DIR\t"):
                return line.split("\t", 1)[1]
        raise ExtractError("remote temp dir creation printed no path")

    def remove_temp_dir(self, name):
        """Delete %TEMP%\\<name> (only names this tool creates); missing is fine."""
        lines = self._ps(_RMTEMP_PS.replace("__NAME__", _ps_literal(_check_temp_name(name))), f"deletion of {name}")
        if "@@GONE" not in lines:
            raise ExtractError(f"remote temp dir {name} may not have been deleted")

    def extract_ranges(self, game_dir, temp_dir, ranges):
        with tempfile.TemporaryDirectory(prefix="dsp-extract-") as local:
            listing = Path(local) / "ranges.txt"
            listing.write_text("".join(f"{p}\t{o}\t{n}\n" for p, o, n in ranges), encoding="utf-8")
            remote = f"{self.asset}:{_win_to_opsctl(temp_dir)}"
            self._cp(str(listing), f"{remote}/ranges.txt", "upload of range list")
            total = sum(n for _, _, n in ranges)
            self.log(f"remote: reading {len(ranges)} ranges, {total / 1e6:.1f} MB")
            lines = self._ps(_RANGES_PS.replace("__GAME__", _ps_literal(game_dir)).replace("__TMP__", _ps_literal(temp_dir)),
                             "range read")
            if f"@@OK\t{total}" not in lines:
                raise ExtractError(f"remote range read did not finish: {lines[-5:]}")
            blob = Path(local) / "ranges.bin.gz"
            self._cp(f"{remote}/ranges.bin.gz", str(blob), "download of range data")
            with gzip.open(blob, "rb") as f:
                return f.read()


def stderr_log(msg):
    print(msg, file=sys.stderr, flush=True)
