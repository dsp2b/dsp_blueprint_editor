# tools/extract

Extracts game data from Dyson Sphere Program (0.10.34 or newer) with UnityPy and writes one
versioned raw directory that all consumer-facing data is generated from.

## Setup

Python 3.12. From the repository root:

```sh
uv venv --python 3.12 tools/extract/.venv
uv pip install --python tools/extract/.venv/bin/python -r tools/extract/requirements-dev.txt
# or: python3.12 -m venv tools/extract/.venv && tools/extract/.venv/bin/pip install -r tools/extract/requirements-dev.txt
```

Tests (no game files needed; runs `tests/`, `models/tests/` and `convert/tests/`). The model tests
run the glTF validator, which needs `node` and a one-time `npm ci` in `tools/extract/validate/`:

```sh
(cd tools/extract/validate && npm ci)
cd tools/extract && .venv/bin/python -m pytest
```

## Running

Always run from the repository root.

Local game install (the directory that contains `DSPGAME_Data/` and `Locale/`):

```sh
tools/extract/.venv/bin/python -m tools.extract --game "/path/to/Dyson Sphere Program" --out tools/extract/out
```

Game installed on another machine, reached via an `opsctl` asset (Windows, PowerShell):

```sh
tools/extract/.venv/bin/python -m tools.extract --remote rdp-ssh --out tools/extract/out
# non-default install location:
#   --remote-game-dir "D:/SteamLibrary/steamapps/common/Dyson Sphere Program"
```

After a game update, one command regenerates everything: the raw extraction, the GLB export and the
conversion into every consumer (each destination is optional; give the ones to write):

```sh
tools/extract/.venv/bin/python -m tools.extract --remote rdp-ssh --out tools/extract/out update \
  --preview-data src/data --locales src/locales --icons src/assets/icons --models public/models \
  --go-data ../dsp2b-go/data --frontend-data ../dsp2b-frontend/app/services \
  --frontend-icons ../dsp2b-frontend/public/images/icons
```

The steps also run on their own: the bare command (raw extraction), `models` (GLB export into
`raw/<version>/models/`) and `convert` (same destination options as `update`, from an existing raw directory).

The remote mode only reads the game directory. It pulls just the byte ranges it needs (about
110 MB, gzip-compressed in transit, about 3 minutes) through a scratch directory
`%TEMP%\dsp-extract-<guid>` on the remote machine. That directory is deleted when the run
ends, whether it succeeds or fails. Local and remote runs produce identical output.

The tool prints the game version. It exits non-zero without writing anything when:

- a required file is missing;
- the game is older than 0.10.34;
- a buildable item (`CanBuild`, `ModelIndex > 0`) has a model without a SlotConfig selection
  box and is not one of the belt models (35/36/37), which have no static model.

The uncovered items are listed in that case.

## Output: `<out>/raw/<version>/`

| Path | Content |
|---|---|
| `protosets/{Item,Recipe,Tech,Signal,Model,MIDI}ProtoSet.json` | full ProtoSet type trees plus `gameVersion` |
| `locale/<lcid>.json` | every installed language: `{lcid, name, code, abbr, fallback, tables: {table: {key: text}}}` |
| `icons/{item_recipe,tech,signal}/<name>.png` | icons named by `IconPath` basename |
| `buildings.json` | `models`: every model whose prefab has a SlotConfig (`selectSize`, `selectCenter`, `slotPoses`/`insertPoses` as root-relative `{pos, rot[x,y,z,w]}`, `tint` = main material `_Color` RGBA, `work` = PrefabDesc work parameters such as `assemblerSpeed`, `labAssembleSpeed`, `beltSpeed`, `inserterSTT`, `minerPeriod`); `items`: `grade`/`upgrades`/`buildIndex`/`modelIndex`/`modelCount` of every `CanBuild` item |
| `manifest.json` | game version, size and sha256 of every file, per-item coverage, icons not found |

Re-running against the same game version replaces the directory with byte-identical content.

## Code map

- `source.py`: `GameSource` (`read(path, offset, length)`, `read_ranges`, `size`, `listdir`),
  `LocalGameSource`, `RemoteGameSource` with the `OpsctlHost` transport.
- `unity.py`: the UnityPy reader (type trees from `Managed/*.dll`, ProtoSets, prefab trees,
  icons) and the sparse-file prefetching used for remote reads.
- `buildings.py`: SlotConfig, tint and work parameters, mirroring `PrefabDesc`.
- `raw.py`: the pipeline and atomic output writing. `cli.py`: argument parsing.
- `models/`, `convert/`, `update/` (all three steps in one run): subcommand packages. Each exposes `register(subparsers)`, which is
  discovered automatically. The handler contract is described in `cli.py`.
