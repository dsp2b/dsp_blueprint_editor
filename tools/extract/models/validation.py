"""Runs the Khronos glTF Validator (npm package in tools/extract/validate/) over GLB files."""
import json
import shutil
import subprocess
from pathlib import Path

from ..errors import ExtractError

VALIDATE_DIR = Path(__file__).resolve().parent.parent / "validate"


def validate_glbs(paths):
    """-> [{"file", "errors", "warnings", "messages"}] in input order. Raises ExtractError when the
    validator itself cannot run (node or `npm ci` in tools/extract/validate/ missing)."""
    paths = [str(p) for p in paths]
    node = shutil.which("node")
    if node is None:
        raise ExtractError("node is required to run the glTF validator")
    if not (VALIDATE_DIR / "node_modules" / "gltf-validator").is_dir():
        raise ExtractError(f"glTF validator not installed: run `npm ci` in {VALIDATE_DIR}")
    out = []
    for i in range(0, len(paths), 50):
        r = subprocess.run([node, str(VALIDATE_DIR / "validate.mjs"), *paths[i:i + 50]], capture_output=True, text=True)
        if r.returncode not in (0, 1):
            raise ExtractError(f"glTF validator failed (exit {r.returncode}): {r.stderr.strip()[-500:]}")
        out += [json.loads(line) for line in r.stdout.splitlines() if line.startswith("{")]
    if len(out) != len(paths):
        raise ExtractError("glTF validator returned fewer results than files")
    return out
