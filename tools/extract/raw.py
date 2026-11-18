"""The raw extraction: game files -> raw/<version>/ (ProtoSets, locales, icons, buildings, manifest).

Everything is computed in memory first and written only once every check has passed, so a failed
run leaves the output directory untouched.
"""
import hashlib
import io
import os
import posixpath
import re
import shutil
from pathlib import Path

from .buildings import SCRIPTS, building_entry
from .coverage import coverage
from .errors import ExtractError
from .jsonout import dump_json
from .locales import read_locales
from .preflight import check_required_files, check_version

PROTOSETS = ("Item", "Recipe", "Tech", "Signal", "Model", "MIDI")
ICON_SOURCES = (("Item", "item_recipe"), ("Recipe", "item_recipe"), ("Tech", "tech"), ("Signal", "signal"))
_SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._ -]*")


class CoverageError(ExtractError):
    def __init__(self, uncovered):
        self.uncovered = uncovered
        lines = [f"  item {u['item']} {u['name']}: model(s) {', '.join(map(str, u['missing']))} "
                 f"have no SlotConfig selection box and are not marked as having no static model"
                 for u in uncovered]
        super().__init__(f"{len(uncovered)} buildable item(s) uncovered:\n" + "\n".join(lines))


def png_bytes(img):
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG", compress_level=9, optimize=False)
    return buf.getvalue()


def extract_icons(reader, protosets):
    wanted = {}  # (category, file name) -> icon path
    by_key = {}  # (category, lower-cased file name) -> first icon path
    for ps, category in ICON_SOURCES:
        for entry in protosets[ps]["dataArray"]:
            path = entry.get("IconPath") or ""
            if not path:
                continue
            name = posixpath.basename(path)
            if not _SAFE_NAME.fullmatch(name):
                raise ExtractError(f"unexpected icon name {path!r} in {ps}ProtoSet")
            # 大小写不敏感的文件系统上 Iron.png 与 iron.png 是同一个文件：不同资源不能落到这样的两个名字上
            key = (category, name.lower())
            prev = by_key.setdefault(key, path)
            if prev.lower() != path.lower():
                raise ExtractError(f"icons {prev!r} and {path!r} would both be written as {category}/{name}.png")
            # 同一资源只是大小写不同：内容相同，两个名字都写（前端按各自的名字引用）
            wanted.setdefault((category, name), path)
    images = reader.icons(sorted({p for p in wanted.values()}))
    files, missing = {}, []
    for (category, name), path in sorted(wanted.items()):
        img = images.get(path)
        if img is None:
            missing.append({"category": category, "iconPath": path})
            continue
        files[f"icons/{category}/{name}.png"] = png_bytes(img)
    return files, missing


def build_buildings(reader, protosets):
    models = []
    for model in sorted(protosets["Model"]["dataArray"], key=lambda m: m["ID"]):
        path = model.get("PrefabPath") or ""
        if not path:
            continue
        root = reader.prefab(path, SCRIPTS)
        if root is None:
            continue
        entry = building_entry(model, root)
        if entry is not None:
            models.append(entry)
    items = [{"id": it["ID"], "name": it.get("Name"), "grade": it.get("Grade"), "upgrades": list(it.get("Upgrades") or []),
              "buildIndex": it.get("BuildIndex"), "modelIndex": it.get("ModelIndex"), "modelCount": it.get("ModelCount")}
             for it in sorted(protosets["Item"]["dataArray"], key=lambda i: i["ID"]) if it.get("CanBuild")]
    return models, items


def build_manifest(version, files, coverage_records, missing_icons):
    return dump_json({
        "gameVersion": version,
        "files": {k: {"size": len(v), "sha256": hashlib.sha256(v).hexdigest()} for k, v in sorted(files.items())},
        "coverage": {"items": coverage_records, "uncovered": []},
        "missingIcons": missing_icons,
    })


def _report(msg):
    print(msg, flush=True)


def extract_raw(source, reader_factory, log, report=_report):
    """Returns (version, {relative path: bytes}) or raises ExtractError.

    `log` takes progress messages, `report` the lines meant for the maintainer (stdout)."""
    check_required_files(source)
    reader = reader_factory(source, log)
    try:
        return _extract(source, reader, log, report)
    finally:
        close = getattr(reader, "close", None)
        if close:
            close()


def _extract(source, reader, log, report):
    version = check_version(reader.version())
    report(f"DSP game version: {version}")
    protosets = {name: reader.protoset(f"{name}ProtoSet") for name in PROTOSETS}
    files = {f"protosets/{name}ProtoSet.json": dump_json({"gameVersion": version, **tree}, sort_keys=False)
             for name, tree in protosets.items()}
    files.update(read_locales(source))
    icon_files, missing_icons = extract_icons(reader, protosets)
    files.update(icon_files)
    models, items = build_buildings(reader, protosets)
    records, uncovered = coverage(protosets["Item"]["dataArray"], {m["modelIndex"] for m in models})
    if uncovered:
        raise CoverageError(uncovered)
    files["buildings.json"] = dump_json({"gameVersion": version, "models": models, "items": items})
    files["manifest.json"] = build_manifest(version, files, records, missing_icons)
    report(f"{len(models)} building models, {len(items)} buildable items, {len(icon_files)} icons, "
           f"{len(missing_icons)} missing icons")
    return version, files


def write_raw(out_dir, version, files):
    """Atomically (re)place out_dir/raw/<version>/ with exactly `files`."""
    if not re.fullmatch(r"\d+(\.\d+)+", version):
        raise ExtractError(f"refusing to use {version!r} as a directory name")
    raw_dir = Path(out_dir) / "raw"
    target = raw_dir / version
    staging = raw_dir / f".{version}.partial-{os.getpid()}"
    old = raw_dir / f".{version}.old-{os.getpid()}"
    raw_dir.mkdir(parents=True, exist_ok=True)
    try:
        for rel, data in files.items():
            p = staging / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        if target.exists():
            target.rename(old)
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if old.exists() and not target.exists():
            old.rename(target)
        raise
    shutil.rmtree(old, ignore_errors=True)
    return target
