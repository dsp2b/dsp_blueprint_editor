# Game data extraction and building gap-fill

> Status: Approved
> Owner: dsp2b maintainers
> Last updated: 2026-11-18

**Objective:** One command reads everything dsp2b needs from an installed Dyson Sphere Program (0.10.34 and later): item/recipe/tech/signal data, icons, translations, building selection boxes and tint colours, and the 3D models of buildings, belts and sorters. The command emits each consumer's data in a single pass. Building metadata in the blueprint preview tool is entirely game-sourced, and every buildable building in the game is covered.

**Hard invariant:** Blueprint parsing/export behaviour and the existing tests do not regress (`yarn test:unit` all green). Extraction only reads the game installation directory and never writes to it. Data formats currently consumed by dsp2b-go and dsp2b-frontend stay compatible.

## Problem

1. **Building metadata is hand-maintained and partly wrong.** `src/data/building.ts` hand-writes the box size and colour for 61 models. Compared with the game's `SlotConfig.selectSize/selectCenter`, 52 match and 9 do not. The four-way splitter models 39/40 were copied from model 38 by mistake. The colours are eyeballed and drift from the game material's `_Color`: assembler Mk.I is #FFA84E in-game vs 0xEDAB5C in the file. (Verified: 2026-11-18 extraction comparison, `/tmp/dsp_probe/scripts/compare.py`.)
2. **Missing buildings.** Against game 0.10.35 data, the preview tool lacks: item and model metadata for the laser beacon 2401 (model 664), model metadata for the orbital collector 2105 (model 117), and the item black-fog gravitational lens 1211. (Verified: comparison of `ldb_ItemProtoSet.json` with `itemsData.ts`/`building.ts`.)
3. **The data update flow depends on manual export.** `src/data/gen.sh` takes AssetStudio's manual export directory (`BASE='/path/to/AS_exports'`) as input. dsp2b-go and the frontend rely on a separate ad-hoc script (`re_dsp_0.10.35/gen_protoset.py`). Every game update means manually repeating several unrelated steps. (Verified: file contents.)
4. **Missing 3D assets.** The redesigned preview (see the 2026-11-18-preview-redesign spec) needs real models for buildings, belts and sorters, and there is no reproducible way to produce them. A spike has proven extraction is feasible. (Verified: 7 building GLBs, 3 belt GLBs and 4 sorter GLBs were exported and passed the Khronos validator.)

## Actors and user stories

1. As a **dsp2b maintainer**, I want one command to regenerate all dsp2b game data and models after a game update, so that I don't have to repeat manual exports and comparisons.
2. As a **blueprint preview tool user**, I want blueprints containing laser beacons and orbital collectors to preview correctly, with building sizes and colours that match the game.
3. As a **dsp2b-go / frontend maintainer**, I want my data to come from the same extraction, so that it never disagrees with the preview tool.

## Design decisions

| # | Decision | Basis and rejected option |
|---|---|---|
| 1 | The extraction tool lives in this repository (blueprint preview tool) under a standalone tools directory. It writes into this repo and, via one sync step, into sibling dsp2b-go / dsp2b-frontend directories. | The preview tool is the heaviest consumer (data, icons, translations, models). Rejected: a new standalone repo, which adds maintenance and permission overhead. Rejected: putting it in dsp2b-go, which would put a Python tool in a Go repo. (Assumption, can be changed at review.) |
| 2 | Use UnityPy plus type trees generated from the game DLLs to parse files directly; `LODModelDesc` is hand-parsed. Texture streaming data is read by byte range. | Proven in the spike. Rejected: AssetStudio manual export, which cannot be automated. |
| 3 | Building selection boxes and connection slots come from the prefab's `SlotConfig` (`selectSize/selectCenter/slotPoses/insertPoses`). Tint colours come from the main material's `_Color`. A few preview-only tweaks (belt and sorter boxes) live in a small hand-maintained override list, and each tweak must state its reason. | The game data is authoritative. Belts/sorters were deliberately narrowed for previewing. Rejected: carrying the whole `building.ts` hand table forward. |
| 4 | Building models export two levels: LOD0 (highest) and the lowest LOD; single-LOD models export once. Textures are ≤512 px JPEG. Normal and metallic/smoothness maps are dropped. | Spike estimate: ~11.2 MB for everything at LOD0, ~8.8 MB at the lowest LOD. The preview needs distance-based switching (see the redesign spec). Rejected: original-resolution textures, which are too large. |
| 5 | Belts export the `belt-seg` segment and `belt-head` end caps per tier. Sorters export 4 tiers × (full + LOD2), with parts split by A/B end frame. Scroll speed, arrow speed and tint go into glTF material `extras`. | The game renders belts by shader sweep and sorters by two-end frames; there is no static whole model. |
| 6 | Publishing the extracted models, textures and icons on the public site is approved. | User decision (2026-11-18: "accept publishing game models on the public site"). |
| 7 | The tool may run directly against a local game directory, or pull byte ranges remotely from the machine that has the game installed. | The game is installed on the Windows machine (rdp-ssh); the dev machine has no game. Both modes yield identical output. |

## Inputs and runtime

- Precondition: a Steam DSP install directory is reachable (locally or via remote byte-range reads). Action: the maintainer runs the extraction command with the game directory and an output directory. Result: the tool reads the version string from the game files and prints it, then generates all outputs.
- If the game is older than 0.10.34, or a required file is missing (`resources.assets`, `globalgamemanagers*`, `Managed/*.dll`, the `.resS` files needed for textures), the tool exits non-zero before writing any output and names the missing item or version.
- The tool only reads the game directory. Any temporary files on the remote machine live in a temp directory and are deleted on exit (including on failure).
- Re-running against the same game version produces byte-identical output (deterministic ordering, fixed compression parameters).

## Outputs

### Raw extraction directory

All consumer-facing outputs are generated from one versioned intermediate directory. It contains:
- ProtoSet JSON for items/recipes/tech/signals/models (with game version)
- Translation tables
- The icon set
- Per-model selection box and tint
- All GLBs
- A manifest: game version, each file's size and hash, building model triangle counts and LOD levels

Every buildable item (`CanBuild` with `ModelIndex > 0`) must be accounted for in the manifest: either it has a model and selection box, or it is explicitly marked as having no static model (the 3 belt models). If any buildable item is not covered, the tool exits non-zero and lists those items.

### Blueprint preview tool data

- Item, recipe, tech icon, signal icon and MIDI data plus translations are fully regenerated, replacing the current output of `gen.sh`. Item entries include 2401 and 1211.
- Building metadata (box size, offset, colour, and the position/orientation of connection slots `slotPoses` and sorter insert points `insertPoses`) is generated for every model that has a `SlotConfig`, 67 in total, replacing the hand table. Models 117 (orbital collector) and 664 (laser beacon) are now present.
- Each building model's work parameters (assembly/smelting speed `assemblerSpeed`, lab speed `labAssembleSpeed/labResearchSpeed`, belt speed `beltSpeed`, sorter speed, mining speed, and so on, from `PrefabDesc`) and each item's `Grade/Upgrades/BuildIndex` are emitted along with the building metadata, for material-flow calculation and belt/sorter animation speed.
- Icons are written to the existing `src/assets/icons/{item_recipe,tech,signal}/` locations.
- Models are written to a static asset directory, by model index and LOD, served by the site and lazy-loaded at runtime.

### dsp2b-go and dsp2b-frontend data

- Regenerates dsp2b-go's `data/*.json` and the frontend's ProtoSet copy and icons, in the format they currently consume. `gen_protoset.py`'s rules are absorbed: wrapper structure, boolean field conversion, IconPath style.
- Compatibility check: for the same game version, regenerated files must agree with the current files on every entry and field present in both. Only additions or game-side changes may differ, and the tool's report lists the differences.

## Building gap-fill (preview tool behaviour)

- Precondition: a 0.10.34+ blueprint containing a laser beacon is pasted.
  - Action: open it in the preview tool.
  - Result: the laser beacon shows at the correct size; its parameter panel shows colour, height, radius, visibility, detail level, icon, signal and label text (parameter layout per the decompiled `BuildingParameters` Marker branch: [0] colour … [7] dfAttractionFlags, [47] comment length, [48..] contentColorIndex; text from `BlueprintBuilding.content`).
  - Export: the parameters and text survive round-tripping.
- Precondition: a blueprint containing an orbital collector is pasted.
  - Result: it shows at the correct size. Parameters are parsed with the station layout; when everything is zero, nothing is shown.
- Unknown parameters for any other building keep the current "store raw, do not interpret" behaviour.

## Out of scope

- Rendering, interaction and UI changes in the preview tool: see `2026-11-18-preview-redesign`.
- Running extraction automatically in CI: CI has no game installed.
- Extracting meshes for vegetation, ore and Dark Fog units.

## Testing decisions

| Seam | What it verifies | Prior art |
|---|---|---|
| Converter unit tests (raw extraction JSON → each consumer's format) | Field mapping, boolean conversion, sort order, override list application | `gen_protoset.py` rules; no tests yet |
| Building metadata golden comparison | Generated boxes agree with the game at the 52 known-matching points; the 9 differing points follow the override list | 2026-11-18 compare.py result |
| Coverage check (built into the tool) | Every buildable item is covered; exits non-zero otherwise | none |
| GLB validation (Khronos glTF Validator) | 0 errors, 0 warnings for all GLBs | Spike validate.mjs |
| Parser unit tests | Laser beacon parameters/text round-trip; orbital collector all-zero parameters | `tests/unit/blueprint/parser.spec.ts` |
| dsp2b-go compatibility | Regenerated `data/*.json` are consumed by the existing Go tests | `dsp2b-go/internal/service/blueprint_svc/blueprint_test.go` |

Cannot be automated: the extraction itself depends on the game install (CI does not have it). After running it, the maintainer checks the tool report (version, coverage, diff summary) and spot-checks the rendering of a few models (including power plant model 54, whose selection centre is off-centre, as the mirroring check).

## Open questions

