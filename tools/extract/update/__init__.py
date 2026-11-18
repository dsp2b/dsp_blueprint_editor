"""`update` subcommand: everything after a game update in one run.

    python -m tools.extract (--game DIR | --remote HOST) --out DIR update [--skip-validate]
        [--preview-data src/data] [--locales src/locales] [--icons src/assets/icons] [--models public/models]
        [--go-data ../dsp2b-go/data] [--frontend-data ../dsp2b-frontend/app/services]
        [--frontend-icons ../dsp2b-frontend/public/images/icons] [--report FILE]

Runs the raw extraction, the model export (`models`) and `convert` into the given destinations, reading the
game through one source session. See tools/extract/cli.py for the register/handler contract."""
from .. import convert, models
from ..errors import ExtractError


def register(subparsers):
    p = subparsers.add_parser("update", help="raw extraction + models + convert into the given destinations, in one run")
    p.add_argument("--skip-validate", action="store_true", help="do not run the Khronos glTF Validator (needs node)")
    convert.add_destination_args(p)
    p.set_defaults(func=handler, raw=None)


def handler(args, ctx):
    from ..raw import extract_raw, write_raw
    if args.out is None:
        raise ExtractError("update needs --out DIR (raw data goes to DIR/raw/<version>/)")
    convert.require_destination(args)
    with ctx.open_source(args) as source:
        version, files = extract_raw(source, ctx.reader_factory, log=ctx.log)
        args.raw = write_raw(args.out, version, files)
        print(f"wrote {len(files)} files to {args.raw}")
        _, target, count = models.export_into_raw(source, ctx, args.out, args.skip_validate)
        print(f"wrote {count} GLB files to {target}")
    return convert.handler(args, ctx)
