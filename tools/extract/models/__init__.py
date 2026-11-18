"""Building model (GLB) export subcommand: `python -m tools.extract (--game DIR | --remote HOST) --out DIR models`.

Run it after the raw extraction: it reads raw/<version>/buildings.json from --out, exports every static
building model (LOD0 + lowest LOD), the belt segment/head and the sorter parts, validates every GLB with
the Khronos glTF Validator, and only then replaces raw/<version>/models/ and updates the file list in
raw/<version>/manifest.json. See tools/extract/cli.py for the register/handler contract."""
import json

from ..errors import ExtractError
from ..preflight import check_required_files, check_version


def register(subparsers):
    p = subparsers.add_parser("models", help="export building, belt and sorter models as GLB into raw/<version>/models/")
    p.add_argument("--skip-validate", action="store_true", help="do not run the Khronos glTF Validator (needs node)")
    p.set_defaults(func=handler)


def make_game(reader, source, log):
    from .gamedata import GameModels
    return GameModels(reader, source, log)


def handler(args, ctx):
    from .export import export_models, write_models
    from .validation import validate_glbs
    if args.out is None:
        raise ExtractError("models needs --out DIR (the directory holding raw/<version>/)")
    with ctx.open_source(args) as source:
        check_required_files(source)
        reader = ctx.reader_factory(source, ctx.log)
        try:
            version = check_version(reader.version())
            raw_dir = args.out / "raw" / version
            buildings = raw_dir / "buildings.json"
            if not buildings.is_file():
                raise ExtractError(f"{buildings} not found; run the raw extraction for {version} first")
            models = json.loads(buildings.read_bytes())["models"]
            files = export_models(make_game(reader, source, ctx.log), models, ctx.log)
        finally:
            close = getattr(reader, "close", None)
            if close:
                close()

    def stage(directory):
        if args.skip_validate:
            return
        bad = [r for r in validate_glbs(sorted(directory.rglob("*.glb"))) if r["errors"] or r["warnings"]]
        if bad:
            raise ExtractError("glTF validation failed:\n" + "\n".join(f"  {r['file']}: {r['errors']} errors, {r['warnings']} warnings "
                                                                       f"{r['messages'][:2]}" for r in bad[:10]))

    target = write_models(raw_dir, files, stage)
    print(f"DSP game version: {version}\nwrote {sum(f.endswith('.glb') for f in files)} GLB files to {target}")
    return 0
