# Blueprint preview tool redesign: two render modes and UI/UX

> Status: Approved
> Owner: dsp2b maintainers
> Last updated: 2026-11-18

**Objective:** After pasting a blueprint, players can quickly see its contents, throughput, material shortfalls and how it is wired. They can switch between a lightweight "Simple" mode and a "Real model" mode that uses the game's own models, and get a usable experience on both mobile and desktop.

**Hard invariant:** Existing capabilities do not regress:
- Blueprint parsing and export (including the 0.10.32+ format support delivered 2026-11-18)
- Editing the thumbnail icons/layout/text/description
- Copying/saving the blueprint code
- Batch replace, undo/redo
- Every building parameter panel
- Chinese and English UI
- PWA offline use

## Problem

1. **Buildings are invisible after load.**
   - The camera does not aim at the blueprint after pasting. Zooming in still shows no buildings.
   - Verified: screenshot `.dev-kit/artifacts/2026-11-18-preview-redesign/mockups/screens/before-desktop.png`, a real 0.10.35 blueprint with 20 assemblers.
2. **Rendering lacks fidelity and readability.**
   - Buildings are unlit flat boxes; belts and sorters are straight lines. Players can't relate the view to the game.
   - Verified: `before-desktop.png`, and `BlueprintEditor.vue` builds the boxes with unlit-looking `MeshLambertMaterial` boxes.
3. **The sidebar is not organised around tasks.**
   - Thumbnail editing, the code box and the building list are stacked together.
   - There is no answer to "what does this blueprint consume, what does it produce, is it balanced?"
   - Verified: `src/App.vue` template and `BuildingOverview.vue`.
4. **Unusable on mobile.**
   - The sidebar covers most of the screen and the 3D view is squeezed to a narrow strip.
   - Verified: `before-mobile.png`.
5. **Weak error and empty states.**
   - Parse errors are shown verbatim as internal exceptions; issue #2 showed "RangeError: Invalid DataView length".
   - The empty state gives no next step.

## Actors and user stories

1. As a **player**, after pasting a blueprint I want to immediately see it in 3D and read its material flow, so I can decide whether it suits me.
2. As a **player on a slow connection or metered data**, I want the blueprint to open fast and to see the full layout without waiting for model downloads.
3. As a **player on mobile**, I want to view the 3D layout and key info on my phone.
4. As a **blueprint author**, I want to keep editing the thumbnail, description and batch replace, and save a screenshot to share.

## Design decisions

| # | Decision | Basis and rejected option |
|---|---|---|
| 1 | Offer both "Simple" and "Real model" modes, switchable at any time. | User decision: slow networks need a light mode. Rejected: real models only (slow networks wait too long); simple only (user wants the game look). |
| 2 | Default mode is "Auto": Simple when the browser reports data saver or a 2g/3g effective type, otherwise Real model. A manual switch is remembered. Settings offer Auto / Simple / Real model. | User decision ("auto is fine"). |
| 3 | Real model mode loads progressively: everything first renders as Simple-mode boxes, and each building type switches to its real model once downloaded. Simple mode never downloads models. | Avoids a blank wait on slow networks. Rejected: blocking until all models finish downloading. |
| 4 | Real model mode switches by distance between LOD0 and the lowest LOD, and instances each model type. | Extraction estimate: a 1000-building blueprint is 1–2.5M triangles at LOD0 and 50k–150k at the lowest LOD. |
| 5 | Real model mode reproduces the game's belts and sorters in the first version: the belt cross-section is swept along the path, the middle lane scrolls at per-tier speed, and there are edge lights, end caps and cargo items moving along belts. Sorters are posed from the A/B end frames and play the grabbing animation. | Matches the game's rendering (extraction spike). User decision (2026-11-18): edge lights, cargo and sorter animation are in the first version. |
| 6 | Floating recipe badges (constant screen size) in Real model mode. Overlapping badges auto-hide when zoomed out. In Simple mode the icon sits on top of the box. | Real model tops hide icons. User decision: auto-hide is fine. |
| 7 | Sidebar: header (thumbnail, name, version, three main actions) plus three tabs: Overview, Building, Edit. Mobile becomes a bottom sheet. | Mockup v1–v3 settled with the user. |
| 8 | Overview shows the material flow (in/out) and intermediate-product balance warnings. | User decision: keep. |
| 9 | Keep the screenshot button and the recently-opened blueprints list. | User decision: keep. |
| 10 | Visual style: deep-space blue base, blueprint hologram cyan as the interaction accent, the game's Mk.I/II/III tier colours as the only data colours, DIN-like numbers (DIN Alternate / Bahnschrift, no web font). | Mockup. Rejected: generic dark theme + single accent. |
| 11 | Recent blueprints are stored in the browser's local IndexedDB. The 20 most recent are kept, and the user can clear them all. Nothing is uploaded. | Blueprint codes can reach the MB range, beyond what localStorage can hold. |

## Opening a blueprint: empty, loading and error states

- **Empty state** (no blueprint):
  - The 3D view fills the window and the sidebar is hidden. A centred card offers: a paste box, "Paste from clipboard", "Choose file", drag-and-drop of a .txt file, and the latest supported game version.
  - Below the card is the recent-blueprints list (name, icon, time). Clicking an entry opens it.
  - With no history, the list is not shown.
- **Loading:** when parsing takes over 300 ms, the card shows parse progress (buildings read / total).
- **Errors:** parse failures are shown in-card as user-facing text, the pasted content is kept, and the original exception is not shown. At minimum:
  - Not a blueprint code ("does not start with BLUEPRINT:")
  - Checksum mismatch or checksum missing ("the code may be incomplete; copy it again from the game")
  - Truncated or corrupt content
  - Newer than supported ("this blueprint is from game X, newer than the supported Y")
- **After a successful load:**
  - The camera animates to frame the blueprint's bounds; with reduced motion it jumps.
  - The blueprint is written to the recent list (same code is de-duplicated and moved to the top).
- **Paste/drop while a blueprint is open:** replaces the current blueprint. If there are unsaved edits, ask for confirmation first.

## 3D view

### Shared behaviour (both modes)

- Toolbar (bottom-left; icon-only on mobile):
  - Mode toggle (Simple / Real model)
  - Frame blueprint (shortcut F)
  - Top view (T)
  - Recipe badge toggle
  - Belt flow toggle
- Screenshot button (top-right): saves the current 3D view as PNG without UI, named after the blueprint.
- Tier legend: Mk.I / Mk.II / Mk.III colours.
- Hovering a building highlights it and shows a tooltip (building name, recipe).
- Clicking selects it: outline plus base ring, and the sidebar switches to the "Building" tab.
- Esc or clicking empty space deselects.
- Clicking a facility or material row in the sidebar highlights matching buildings in 3D and fades everything else; clicking again clears it.
- Reduced motion (`prefers-reduced-motion`): belt scrolling, the selection ring pulse and camera animation all stop.

### Simple mode

- Buildings are lit boxes with outlines, sized from the game selection boxes (see `2026-11-18-game-data-extraction`), with the recipe or building icon on top.
- Tiered buildings have a tier-coloured base trim.
- Belts are tier-coloured strips with flow arrows; sorters are tier-coloured arcs.
- No model files are downloaded.

### Real model mode

- Buildings use the game models.
- Belts sweep the game belt cross-section along the path:
  - The path is built from the belt chain (`outputObjIdx`) using the game's Bezier rule.
  - Height changes follow the endpoint heights.
  - Includes end caps and edge lights.
  - A belt that connects to a building through a slot (`outputObjIdx`/`inputObjIdx` + `outputToSlot`/`inputFromSlot`) extends to that building's slot position and visibly joins it.
    - This applies to logistics stations, splitters, storage and similar buildings, and holds in both modes.
    - Slot positions come from the game's `SlotConfig.slotPoses`.
  - The middle lane scrolls at per-tier speed.
- Belt cargo:
  - Belts show item plates moving at the belt's speed. Each plate shows the icon of the item the blueprint implies is carried on that belt.
  - Inference: whatever the upstream sorter/building outputs, or the item set by the sorter filter or station slot.
  - Belts whose item cannot be inferred carry no cargo.
  - Cargo density is for illustration only and does not represent actual throughput.
- Sorters place their end pieces/rails at the pick end (`localOffset[0]`, yaw/tilt/pitch[0]) and the place end (`localOffset[1]` and the matching angles). Only the top beam and arrow stretch.
  - Rails show only on an end that connects to a building.
  - The grabber runs the game's grab animation back and forth along the [A raised, A top, B top, B raised] polyline at per-tier speed.
  - While carrying, it shows the carried item (same inference as belts); on the way back it is empty.
- With "Belt flow animation" off or reduced motion, belt scrolling, cargo movement and the sorter animation all stop. Cargo and grabbers then sit at fixed positions.
- Download progress is shown at the top centre (count done / total, MB). Downloaded types replace their boxes immediately; it disappears when done.
- If a model fails to download, that type stays a box, the progress text names the failed count, and the user can retry. Other buildings are unaffected.
- Model files are not part of PWA install-time precache (otherwise Simple mode would download them too). Only models actually downloaded in Real model mode are cached at runtime; types already seen work offline.

### Orientation consistency

The previewed layout must match the game: same handedness, not mirrored. This is checked against an in-game screenshot of the same asymmetric blueprint.

## Sidebar

### Header (always shown after load)

- Thumbnail: rendered from the blueprint's icon layout, icons and thumbnail text.
- Name, game version, creation time.
- Three main actions: "Copy blueprint code" (after copying, the button briefly reads "Copied"), "Save as file", "Switch blueprint" (returns to the empty-state card).
- Settings entry: language (auto / Chinese / English), default display mode (Auto / Simple / Real model), show grid, belt flow animation.

### Overview tab

- Stats: building count, footprint (grid cells), number of areas.
- **Material flow** (theoretical full speed, per minute):
  - Calculated from each production building's recipe time and that building's speed; proliferator bonus is not counted (labelled "proliferator not included").
  - Items consumed but not produced inside the blueprint are "In"; items produced but not consumed are "Out".
  - Mining buildings depend on the ore vein, so their output is shown as "depends on vein" and excluded from the totals.
  - Intermediate products (both produced and consumed) show a supply/demand bar.
  - When supply < demand, a warning is shown: a heading in plain language, each shortfall's amount, and how many more of the corresponding production building are needed to run at full speed (rounded up).
  - Nothing is shown for balanced items.
- **Facilities**: grouped as Production / Logistics / Power / Defence / Other, with icon, tier colour dot and count. Clicking highlights them (see the 3D view).

### Building tab

- With no selection: a prompt to click a building in the view.
- With a selection: building name, index and position, then the existing parameter panel for that building type (recipe, station slots, storage, monitor, dispenser, battle base, splitter, laser beacon, etc.) restyled.
- For production buildings, also: full-speed output per minute, input/output connection summary, "Change recipe" and "Select all N of this type".

### Edit tab

- Thumbnail icons (5 slots), icon layout, thumbnail text, blueprint description.
- Batch replace (existing feature), undo, redo.
- Blueprint code (read-only, copyable).
- All edits are reflected in the code produced by "Copy blueprint code" / "Save as file".

## Mobile (viewport width ≤ 760 px)

- The 3D view fills the screen.
- The sidebar becomes a bottom sheet:
  - Collapsed, it shows the thumbnail, name, building count and the three main actions.
  - Tapping the handle or swiping up expands it to about 78% of the height.
  - Selecting a building expands it automatically to the Building tab.
- The toolbar is icon-only and the legend moves to the top-left.
- The empty state shows the card only.

## Accessibility and i18n

- Every interactive control is keyboard-reachable and has a visible focus ring.
- Sidebar list rows that support highlighting respond to Enter/Space.
- The 3D canvas has a text description.
- Icon-only buttons have accessible names.
- All new copy exists in both Chinese and English and goes through the existing vue-i18n.

## Out of scope

- Building working animations (assembler arms, furnace glow, etc.) (later).
- Linking with the dsp2b site (opening from a blueprint detail page, embedding): not chosen by the user.
- Proliferator effects in the material flow.
- Producing data/models (see `2026-11-18-game-data-extraction`).

## Testing decisions

| Seam | What it verifies | Prior art |
|---|---|---|
| Material-flow calculation (pure function: blueprint → in/out/intermediate/shortfall) | Rate formula, building speed, in/out classification, shortfall and added-building count, mining excluded | none |
| Belt path building (pure function: belt chain → sample points/rotations) | Straight/turn/height-change paths, ends, side merges; agrees with the game Bezier rule | none |
| Sorter pose (pure function: two ends + animation phase → part transforms) | t1/t2 rail visibility, top beam/arrow stretch, grabber position along the polyline | none |
| Carried-item inference (pure function: blueprint → item per belt/sorter) | Inferred from upstream building output, sorter filter, station slot; nothing when unknown | none |
| Display mode selection (pure function: network info + saved preference → mode) | Auto/Simple/Real rules and remembering | none |
| Parse error mapping | Each parser exception maps to the user-facing text above | `parser.spec.ts` |
| Recent blueprints storage | De-dup, 20-entry cap, clear all | none |
| Existing parse/export/batch replace tests | Hard invariant | `tests/unit/blueprint/*.spec.ts` |

Cannot be automated:
- Visual fidelity, orientation consistency and mobile interaction. Covered at wrap-up by headless-browser screenshots of real blueprints in both modes on desktop and mobile, compared against in-game screenshots on the game machine (rdp-ssh).
- Performance. Spot-checked with a 1000+ building real blueprint in both modes: the view must stay interactive (rotate/zoom without obvious stutter), and Simple mode must render within 2 seconds of parsing.

## Open questions

