"""`convert` subcommand: raw extraction directory -> every consumer's data format.

    python -m tools.extract --out DIR convert [--raw DIR/raw/<version>] [--preview-data src/data]
        [--locales src/locales] [--icons src/assets/icons] [--go-data ../dsp2b-go/data]
        [--frontend-data ../dsp2b-frontend/app/services] [--report FILE]

Only the destinations that are given get written. Everything is generated before anything is written. Existing
dsp2b-go / frontend ProtoSet files are compared with the regenerated ones before they are replaced; the
differences are printed (and written to --report as JSON).
"""
import json
import sys
from pathlib import Path

from ..errors import ExtractError
from . import building, preview, protoset, translations
from .rawdata import find_latest_raw, load_raw

PREVIEW_FILES = (
    ("itemsData.ts", lambda r: preview.items_ts(r.protosets["Item"])),
    ("recipesData.ts", lambda r: preview.recipes_ts(r.protosets["Recipe"])),
    ("midi.ts", lambda r: preview.midi_ts(r.protosets["MIDI"])),
    ("signalIconsData.ts", lambda r: preview.signal_ts(r.protosets["Signal"])),
    ("techIconsData.ts", lambda r: preview.tech_ts(r.protosets["Tech"])),
    ("building.ts", lambda r: building.building_ts(r.buildings, r.version)),
)
ICON_DIRS = ("item_recipe", "tech", "signal")


def register(subparsers):
    p = subparsers.add_parser("convert", help="convert a raw extraction into the consumers' data formats")
    p.add_argument("--raw", type=Path, metavar="DIR",
                   help="raw directory <out>/raw/<version> (default: the newest one under --out)")
    p.add_argument("--preview-data", type=Path, metavar="DIR",
                   help="write itemsData/recipesData/midi/signalIconsData/techIconsData/building .ts here (src/data)")
    p.add_argument("--locales", type=Path, metavar="DIR",
                   help="write zh.json/en.json here (src/locales); its existing zh.json keys are kept as extras")
    p.add_argument("--icons", type=Path, metavar="DIR", help="copy item_recipe/tech/signal icons here")
    p.add_argument("--go-data", type=Path, metavar="DIR", help="write dsp2b-go data/*ProtoSet.json here")
    p.add_argument("--frontend-data", type=Path, metavar="DIR", help="write dsp2b-frontend *ProtoSet.json here")
    p.add_argument("--report", type=Path, metavar="FILE", help="write the full compatibility report as JSON")
    p.set_defaults(func=handler)


def _load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError as e:
        raise ExtractError(f"existing {path} is not valid JSON: {e}") from None


def _plan_protosets(raw, directory, to_format, prefix, reports, texts):
    """-> {path: bytes}; fills reports/texts with the comparison against the files that exist now."""
    files = {}
    for table in protoset.GO_SETS:
        name = protoset.filename(table)
        new = to_format(protoset.to_go(raw.protosets[table], table))
        old = _load_json(directory / name)
        if old is not None:
            rep = protoset.compat_report(new, old)
            reports[prefix + name] = rep
            texts.append(protoset.format_report(prefix + name, rep))
        files[directory / name] = protoset.dump(new)
    return files


def _plan_icons(raw, dest):
    files = {}
    for sub in ICON_DIRS:
        for p in sorted((raw.icons_dir / sub).glob("*.png")):
            files[dest / sub / p.name] = p.read_bytes()
    return files


def handler(args, ctx):
    targets = (args.preview_data, args.locales, args.icons, args.go_data, args.frontend_data)
    if not any(targets):
        raise ExtractError("no destination: pass at least one of --preview-data, --locales, --icons, "
                           "--go-data, --frontend-data")
    raw_dir = args.raw or find_latest_raw(args.out) if (args.raw or args.out) else None
    if raw_dir is None:
        raise ExtractError("pass --raw DIR or --out DIR (the directory holding raw/<version>)")
    raw = load_raw(raw_dir)

    files, reports, texts, notes = {}, {}, [], []
    if args.go_data:
        files.update(_plan_protosets(raw, args.go_data, lambda g: g, "", reports, texts))
    if args.frontend_data:
        files.update(_plan_protosets(raw, args.frontend_data, protoset.to_frontend, "frontend/", reports, texts))
    if args.preview_data:
        for name, gen in PREVIEW_FILES:
            files[args.preview_data / name] = gen(raw).encode("utf-8")
    if args.locales:
        existing = _load_json(args.locales / "zh.json") or {}
        out, notes = translations.build_translations(raw.locales, raw.protosets, existing.keys())
        for lang, table in out.items():
            files[args.locales / f"{lang}.json"] = json.dumps(table, ensure_ascii=False, indent=4).encode("utf-8")
    if args.icons:
        files.update(_plan_icons(raw, args.icons))

    written = 0
    for path, data in files.items():
        if path.exists() and path.read_bytes() == data:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        written += 1
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"game version {raw.version}: {len(files)} files, {written} changed")
    for line in texts + notes:
        print(line)
    return 0
