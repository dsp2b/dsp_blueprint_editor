"""Checks that run before anything is parsed or written."""
import re

from .errors import ExtractError

MIN_VERSION = (0, 10, 34)

DATA = "DSPGAME_Data"
# Serialized files UnityPy loads, the stream files holding their texture data, the managed
# assembly the type trees are generated from, and the locale index.
REQUIRED_FILES = (
    f"{DATA}/globalgamemanagers",
    f"{DATA}/globalgamemanagers.assets",
    f"{DATA}/resources.assets",
    f"{DATA}/resources.assets.resS",
    f"{DATA}/sharedassets0.assets",
    f"{DATA}/sharedassets0.assets.resS",
    f"{DATA}/Managed/Assembly-CSharp.dll",
    "Locale/Header.txt",
)


def check_required_files(source):
    missing = [p for p in REQUIRED_FILES if source.size(p) is None]
    if missing:
        raise ExtractError(f"not a usable DSP install ({source.describe()}); missing required file(s): "
                           + ", ".join(missing))


def parse_version(s):
    s = (s or "").strip()
    if not re.fullmatch(r"\d+(\.\d+)+", s):
        raise ExtractError(f"cannot parse game version {s!r}")
    return tuple(int(p) for p in s.split("."))


def check_version(s):
    """Returns the normalised version string or raises if the game is too old."""
    v = parse_version(s)
    if v[:3] < MIN_VERSION:
        need = ".".join(map(str, MIN_VERSION))
        raise ExtractError(f"game version {s.strip()} is older than {need}; this tool needs {need} or newer")
    return s.strip()
