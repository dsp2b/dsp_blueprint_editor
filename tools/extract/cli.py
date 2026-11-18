"""Command line entry: `python -m tools.extract (--game DIR | --remote HOST) --out DIR [COMMAND ...]`.

Without COMMAND it runs the raw extraction into DIR/raw/<version>/. Subcommands come from the
sub-packages of tools.extract (models/, convert/, ...): each exposes `register(subparsers)` that adds
its parser and sets `func=handler`; the handler is called as `handler(args, ctx) -> exit code`,
where `ctx.open_source(args)` yields the GameSource selected by --game/--remote.
"""
import argparse
import importlib
import pkgutil
import sys
from pathlib import Path

from .errors import ExtractError
from .source import DEFAULT_REMOTE_GAME_DIR, LocalGameSource, OpsctlHost, RemoteGameSource, stderr_log


def discover_subcommand_modules():
    import tools.extract as pkg
    mods = []
    for info in sorted(pkgutil.iter_modules(pkg.__path__), key=lambda i: i.name):
        if not info.ispkg or info.name == "tests":
            continue
        mod = importlib.import_module(f"{pkg.__name__}.{info.name}")
        if callable(getattr(mod, "register", None)):
            mods.append(mod)
    return mods


def build_parser():
    p = argparse.ArgumentParser(prog="python -m tools.extract",
                                description="Extract game data from Dyson Sphere Program (0.10.34+).")
    src = p.add_mutually_exclusive_group()
    src.add_argument("--game", metavar="DIR", type=Path, help="local game install dir (contains DSPGAME_Data/)")
    src.add_argument("--remote", metavar="HOST", help="opsctl asset name of the machine that has the game")
    p.add_argument("--remote-game-dir", metavar="DIR", default=DEFAULT_REMOTE_GAME_DIR,
                   help=f"game install dir on the remote machine (default: {DEFAULT_REMOTE_GAME_DIR})")
    p.add_argument("--out", metavar="DIR", type=Path, help="output dir; raw data goes to DIR/raw/<version>/")
    sub = p.add_subparsers(dest="command", metavar="COMMAND")
    for mod in discover_subcommand_modules():
        mod.register(sub)
    return p


class Context:
    def __init__(self, reader_factory, remote_host_factory, log):
        self.reader_factory = reader_factory
        self.remote_host_factory = remote_host_factory
        self.log = log

    def open_source(self, args):
        if args.game is not None:
            return LocalGameSource(args.game)
        if args.remote:
            return RemoteGameSource(self.remote_host_factory(args.remote), args.remote_game_dir, log=self.log)
        raise ExtractError("no game source: pass --game DIR or --remote HOST")


def _default_reader_factory(source, log):
    from .unity import UnityReader
    return UnityReader(source, log=log)


def main(argv=None, *, reader_factory=None, remote_host_factory=None):
    from .raw import extract_raw, write_raw

    parser = build_parser()
    args = parser.parse_args(argv)
    log = stderr_log
    ctx = Context(reader_factory or _default_reader_factory,
                  remote_host_factory or (lambda asset: OpsctlHost(asset, log=log)), log)
    try:
        if args.command:
            return args.func(args, ctx)
        if (args.game is None and not args.remote) or args.out is None:
            parser.error("raw extraction needs --game DIR or --remote HOST, and --out DIR")
        with ctx.open_source(args) as source:
            version, files = extract_raw(source, ctx.reader_factory, log=log)
        dest = write_raw(args.out, version, files)
        print(f"wrote {len(files)} files to {dest}")
        return 0
    except ExtractError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
