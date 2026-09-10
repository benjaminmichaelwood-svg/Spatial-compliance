# Spatial Compliance Tool

## Project Overview
Web-based spatial compliance tool for open pit mining. Takes Vulcan .00t triangulation surface files as input, computes cut/fill conformance solids between surface pairs, classifies them into reporting domains, and produces 3D visualisation and PowerPoint reports. Runs entirely in-browser via WASM — no server, no installation.

## Tech Stack
- **Spatial engine:** Rust compiled to WASM (in-browser compute)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 3
- **3D viewer:** Three.js via react-three-fiber
- **Charts:** Recharts
- **Reports:** PptxGenJS for PowerPoint generation
- **Hosting:** GitHub Pages (free static site)
- **Password:** Simple session-based gate, hardcoded password "spatial2026"

## Repository Structure
```
crates/spatial-engine/src/
  format.rs    — Vulcan .00t parser and writer
  bvh.rs       — Bounding volume hierarchy for spatial queries
  solid.rs     — Mesh-on-mesh solid construction (NOT grid-based)
  classify.rs  — Conformance domain classifier (dig/dump modes)
  cutfill.rs   — Cut/fill computation pipeline
  intersect.rs — Triangle-triangle intersection
  boundary.rs  — Lateral boundary splitting (polygon/surface)
  dxf.rs       — DXF polygon parser
  wasm.rs      — WASM bindings
  types.rs     — Shared types
  lib.rs       — Library entry

web/src/
  App.tsx           — Main application
  components/       — React components (Viewer, LayerPanel, ReportPanel, etc.)
  engine.worker.ts  — Web Worker for WASM computation
```

## Vulcan .00t Format Specification
Fully reverse-engineered and validated (zero delta across 68,259 vertices and 134,906 faces vs OBJ export):
- **All values big-endian**
- **Header:** 128 bytes (0x00–0x7F)
  - Offset 0x48: BE u32 = vertex_count
  - Offset 0x60: BE u32 = triangle_count
- **Vertex data:** starts at offset 0x78
  - Each vertex = 24 bytes: 3 × big-endian f64 (Easting, Northing, RL)
- **Triangle data:** starts immediately after vertices, at offset `0x78 + vertex_count × 24`
  - Each triangle = 24 bytes: 3 × BE u32 (1-indexed vertex indices) + 12 bytes zero padding
- **File size** = 128 + (vertex_count × 24) + (triangle_count × 24) — corrected 2026-09 (Priority 10 session): the previous "− 8-byte overlap" text here didn't match `format::decode_surfaces`'s actual (empirically-validated) `expected_size` formula, which has no such subtraction. Found while writing frontend pre-parse validation against the real formula.
- Note: a compressed "vulZ" format variant exists (magic: ea fb a7 8a 76 75 6c 5a) but is NOT yet supported

## Conformance Domains
### Dig Mode (Cut)
- Planned and Mined (green) — volume in plan, mined this period
- Planned Not Mined (red) — volume in plan, not yet mined
- Mined Not Planned (orange) — volume mined outside the plan
- Mined Before Start (blue) — volume mined before the plan period started
- Preschedule Delay (purple) — behind at start due to actual position vs planned start
- Ahead of Plan (cyan) — mined volume planned for a future period

### Dump Mode (Fill)
- Planned and Dumped, Planned Not Dumped, Dumped Not Planned, Dumped Before Start, Dump Preschedule Delay, Dumped Ahead of Plan

## Key Architecture Decisions
- **No grid-based computation** — uses direct mesh-on-mesh BVH-accelerated boolean operations for exact volumes. Grid sampling does not scale for 20km mine sites.
- **Minimum 2 surfaces required** — user assigns surfaces to roles (Production Start/End, Schedule Start/End, Schedule Future). Only assigned surfaces are used; domains adapt accordingly.
- **Web Worker** — all WASM computation runs off the main thread to keep UI responsive.
- **LOD rendering** — 3 detail levels (full, 25%, 5%) with automatic switching during camera movement.
- **No EdgesGeometry** — causes crashes on large meshes. Use shader-based wireframe or material.wireframe only.

## Performance Targets
- 5 surfaces at 50-100MB each (300K+ triangles per surface)
- Mine sites up to 20km long
- 30+ FPS during orbit/zoom
- No browser freezing on any interaction
- Computation runs in Web Worker with progress bar

## Visual Quality Standard (NON-NEGOTIABLE)

The benchmark for all 3D display output is **Deswik, Vulcan, and Maptek PointStudio**. This tool will be judged by mining engineers who use those packages daily. Output that looks worse than those tools is a failed implementation, even if tests pass.

### Definition of visual failure
- Flat-topped, stepped, or blocky prism solids ("Minescape blocks") — solids MUST follow terrain contours smoothly via per-vertex Z interpolation
- Floating disconnected geometry fragments
- Z-fighting, flickering, or overlapping translucent surfaces obscuring each other
- Geometry that ignores the user's visibility toggles
- Colours or gradients that don't match the legend shown
- Jagged domain boundaries where smooth transitions are expected at this data resolution

### Definition of done for ANY change touching geometry generation or rendering
"Tests pass" is NOT done. Done means:
1. `npm run dev`, load test surfaces from `test-data/` (if present), run conformance
2. Visually inspect the 3D result — screenshot it
3. Confirm the result matches the Deswik/Vulcan/PointStudio standard
4. If you cannot run the dev server or inspect visually, you MUST state this explicitly in your completion report: "NOT VISUALLY VERIFIED". Never claim a visual fix is complete without either verifying it or flagging that you could not.

### Standing rules for geometry code
- Prism/solid construction MUST use per-vertex Z interpolation (BVH lookup per vertex), never flat centroid Z per triangle
- Domain painting applies to production_end surface ONLY — never paint all input surfaces
- Rendering uses indexed BufferGeometry + MeshPhongMaterial. NEVER EdgesGeometry, barycentric wireframe shaders, or LOD copies
- All WASM mesh transfer via flat Float32Array/Uint32Array transferables. NEVER serde/JSON for mesh data
- Raycasting via three-mesh-bvh only
- User visibility toggles are ALWAYS respected — no display mode may override them
- Do not add new display modes/toggles unless explicitly requested by the user

### Visual reference targets
- Solid surfaces: smooth continuous shells hugging terrain, like a Vulcan triangulation solid
- Thickness heatmaps: PointStudio compliance-to-design style — gradient painted on surface, vertical colour bar legend, user-controlled scale
- Lighting: directional + ambient so benches, batters, and slopes read clearly at any zoom

### Automated visual verification
Run `node scripts/visual-check.mjs` (requires `npm run dev` on localhost:5173 and Playwright installed). It launches headless Chromium with SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader --use-gl=angle`), loads test surfaces, runs conformance, and saves screenshots to `visual-check/` (gitignored). Use `PORT=NNNN` to override the dev server port. In CI environments, set `CHROME_PATH` to the Chromium executable.

## CAD Viewer Requirements (Deswik-style)
- White or black background (user toggle), no grid floor
- Z-up orientation enforced
- Click-to-set-pivot orbit centre
- Mouse: scroll=zoom, middle-drag=pan, left-drag=orbit
- Keyboard: Z=reset Z-up, F=fit all, Escape=cancel tool, Delete=remove selected
- Directional lighting for topographic shading on slopes/benches
- Faint triangle wireframe via shader (not EdgesGeometry)
- Surface tooltips showing filename and role
- Solid tooltips showing volume, domain, block name
- Per-surface colour/translucency/shading controls

## Features Status
### Built
- .00t parser and writer (uncompressed format)
- BVH-accelerated mesh boolean engine
- Conformance domain classifier (dig/dump, 12 domains)
- React frontend with dark sidebar
- Three.js 3D viewer with LOD and batched rendering
- Drag-and-drop surface upload with role assignment
- DXF boundary import
- Boundary polygon drawing in viewer
- Lateral boundary splitting with user-defined region names
- Waterfall chart and conformance/production donut gauges
- Report scope selector (whole site, per pit, multi-select)
- PDF export (being replaced by PPTX)
- CSV and .00t solid export
- Web Worker for off-thread computation
- GitHub Pages deployment with CI/CD
- Session password gate

### In Progress / Pending
- CAD performance overhaul (laggy, freezes on tab switch)
- Camera controls (click-to-set-pivot, proper pan/orbit/zoom)
- Visual quality (Deswik-style lighting and wireframe)
- Polygon drawing tool (currently broken)
- Cross-section tool (2D elevation profile along user-defined section line)
- PPTX reporting with template upload and live preview
- Definitions slide with domain schematic diagram
- Measurement tools (distance, elevation readout, area)
- View presets (plan, section, isometric)
- Selection with properties panel
- Optional surfaces (minimum 2 instead of all 5)
- File upload filter fix (.00t greyed out on iOS)
- vulZ compressed .00t format support

## Session Log — 2026-07-21

### What Was Done
**BUG 1 — Volume/thickness filter producing wrong results:**
- Root cause: `compute_signed_volume()` in `solid.rs` suffered catastrophic floating-point cancellation with mine coordinates far from origin (e.g., 782000, 7331000). Per-tetrahedron values ~1e19 cancel to ~100 m³, exceeding f64 precision.
- Fix: translate all vertices to local origin (subtract first vertex) before computing. Files changed: `crates/spatial-engine/src/solid.rs`
- Added 2 integration tests in `crates/spatial-engine/src/classify.rs` (~line 1685+): `volume_filter_at_mine_coordinates` and `signed_volume_mine_coords_accurate`
- Rebuilt WASM: `web/public/spatial_engine_bg.wasm`

**BUG 2 — Cross-section tool (5 sub-items):**
- Surface checkboxes not toggling visibility — changed to use local `hiddenProfiles`/`hiddenSolids` state only, removed dependency on parent 3D `surfaceVisible`/`domainVisible` maps. File: `web/src/components/CrossSectionPanel.tsx`
- Domain solid fills not showing — `flatDomainToLightDomainSolid` was creating DomainSolid with empty `vertices: []` and `indices: []`. Renamed to `flatDomainToDomainSolid` and now reconstructs full vertex/index arrays from Float32Array/Uint32Array. File: `web/src/App.tsx`
- Plan overview panel empty — added surface intersection traces to overview canvas. File: `web/src/components/CrossSectionPanel.tsx`
- CTRL+scroll to step section line — implemented perpendicular stepping. File: `web/src/components/CrossSectionPanel.tsx`
- Forward/back step buttons — added ◀/▶ buttons with auto-calculated step size. File: `web/src/components/CrossSectionPanel.tsx`

**BUG 3 — Measure/distance tool redesign (Deswik-style):**
- Ruler icon, click point 1, live tooltip with Distance/Plan Length/dZ/Bearing/Grade/Coordinates following cursor, click point 2 to lock. Added `computeMeasureMetrics()`, `MeasureCursorTracker` component, floating tooltip overlay. File: `web/src/components/Viewer.tsx`, `web/src/App.tsx`

**BUG 4 — Wire toggle only works for Schedule Future:**
- Added `wireframe={style.wireframe}` to `meshPhongMaterial` in both `SurfaceMesh` and `BatchedDomainGroup`. File: `web/src/components/Viewer.tsx`

### What Failed / Approaches to Avoid
- **WASM pkg directory confusion:** `wasm-pack build` outputs to `crates/spatial-engine/pkg/` when run from inside the crate. Must copy explicitly: `cp crates/spatial-engine/pkg/spatial_engine_bg.wasm web/public/`. The `web/public/pkg/` path is gitignored — only the copy at `web/public/spatial_engine_bg.wasm` should be staged.
- **Cross-section variable naming conflict:** Using `p1`/`p2` for section line endpoints before the destructured `const [p1, p2] = sectionLine` caused shadowing errors. Renamed to `sl1`/`sl2`.
- **Grid-based volume computation:** Never use grid sampling — direct mesh-on-mesh with BVH is the only approach that scales for 20km mine sites. This was already established but worth repeating.

### What's Still Broken / Known Issues
- All changes are **NOT VISUALLY VERIFIED** — dev server was not started for interactive testing this session
- Cross-section tool overall still listed as "In Progress" — the 5 fixes above address specific bugs but full feature may need more work
- Polygon drawing tool still broken (not addressed this session)
- CAD performance still laggy (not addressed this session)
- Camera click-to-set-pivot not implemented
- PPTX reporting still in progress
- iOS .00t file upload filter still broken

### Git Status
- **Branch:** `claude/mining-spatial-compliance-tool-0ypu8c` — merged to `main`, both pushed and in sync
- **Latest commit on main:** `b26cd40 Fix wireframe toggle, measure tool redesign, cross-section improvements`
- **All changes committed and pushed:** Yes
- **Working tree:** Clean, nothing uncommitted
- **67 Rust tests pass** (65 original + 2 new), 2 ignored (require local .00t files)

## Session Log — 2026-09-10 (Master Action List, item 1 of 22)

Working through a 22-item prioritized action list (rendering/build/repo hygiene + backend/usability/functionality) one item at a time on branch `claude/md-file-review-pf1dfr`.

### Master Priority 1 — Ship a release-optimized WASM binary
- **Change:** `.github/workflows/deploy.yml`'s "Build WASM" step now explicitly passes `--release`: `wasm-pack build --release --target web crates/spatial-engine`.
- **Verified `[profile.release]` (opt-level = "s", lto = true) actually applies:** built the crate three ways with the wasm-pack version installed in this environment (0.13.x class) — explicit `--release`, explicit `--dev`, and no flag at all. Result: **no-flag and `--release` both produced an identical 349,621-byte optimized binary** ("Finished `release` profile [optimized]"); `--dev` produced a 1,097,504-byte unoptimized binary (3.1x larger, "unoptimized + debuginfo"). This confirms the installed wasm-pack already defaults to the release profile when no flag is given.
- **Important finding:** the wasm binary already committed at `web/public/spatial_engine_bg.wasm` (349,621 bytes) is byte-for-byte identical to a fresh `--release` build except for 1 non-deterministic byte (a build-artifact hash/section that varies run-to-run even with zero source changes — confirmed via `git status` showing no drift in `crates/spatial-engine/src` before the rebuild). **The production binary currently served was already release-optimized.** This change makes that explicit and removes the ambiguity for future wasm-pack versions/environments rather than fixing an active mis-build — the risk the action list flagged was real in principle (wasm-pack's documented default has changed across versions) but was not actually manifesting in the current deployment.
- **wasm binary size: before = 349,621 bytes, after = 349,621 bytes (no functional change).**
- Did not change `opt-level`/`lto` values (out of scope per this item).
- `cargo test --lib` on `crates/spatial-engine`: 67 passed, 2 ignored (unchanged from prior session).

### Master Priority 2 — Panic recovery + error hardening
- **`console_error_panic_hook` wired in:** added as a dependency and called via `#[wasm_bindgen(start)] pub fn init_panic_hook()` in `wasm.rs` — runs automatically on module instantiation (no JS changes needed; `web/src/wasm.ts`'s `mod.default(...)` already triggers it). Any panic that still occurs now surfaces as a real JS console error with a Rust stack trace instead of an opaque `RuntimeError: unreachable executed`.
- **Audited all 51 `.unwrap()`/`.expect()` call sites** across `format.rs`, `classify.rs`, `dxf.rs`, `bvh.rs`, `boundary.rs`, `solid.rs`, `intersect.rs`, `wasm.rs`, plus the `gen_test_surfaces` dev binary. ~25 are inside `#[cfg(test)]` modules operating on hand-crafted fixtures — never reachable from untrusted input — and were left untouched with no individual comments (would be pure noise). The 2 in `gen_test_surfaces.rs` are a local CLI dev tool, not part of the WASM/browser path — left as-is with a note.
- **Converted to graceful handling (real bugs found and fixed, not just re-labeled):**
  - **New: `TriSurface::validate()` in `types.rs`** — checks every triangle index is in-bounds for `vertices` and every coordinate is finite. This closes a real gap: `format::decode_surfaces` already validated the binary `.00t` path, but every JSON-based WASM entry point (`run_conformance*_json`, `run_cut_fill_from_json`, `encode_surface_pair`, `encode_surfaces_from_json`, `extract_boundary_from_surface_json`) deserialized a `TriSurface` straight from untrusted JSON with zero validation — an out-of-bounds triangle index would panic on raw array indexing in `TriSurface::triangle()`/`bvh.rs`/`solid.rs` with no recovery. All of these entry points in `wasm.rs` now call `.validate()` and return a descriptive `Result` error instead.
  - **`format.rs`**: `decode_surfaces` now rejects non-finite (NaN/Infinity) vertex coordinates with a descriptive error identifying the vertex index — a corrupt `.00t` file can produce a NaN via an ordinary bit pattern, which previously sailed through parsing and panicked later.
  - **`bvh.rs`**: the centroid-sort comparator used `partial_cmp(...).unwrap()`, which panics on NaN. Now uses `f64::total_cmp` (never panics, well-defined total order) as defense in depth even though `validate()` should prevent NaN from reaching this point at all.
  - **`boundary.rs`**: `extract_surface_outline`'s largest-loop selection had the same `partial_cmp(...).unwrap()` NaN-panic risk on `polygon_area()`; also switched to `total_cmp`.
- **Left as `.unwrap()` with a `// SAFETY (panic audit):` comment explaining why (genuinely can't fail given the surrounding guard):** `format.rs` `read_be_u32`/`read_be_f64` (bounds already checked by every caller in `decode_surfaces`); `wasm.rs`'s `serde_json::to_string(&d.domain)` (serializing a plain enum can't fail); `intersect.rs::chain_segments` and `dxf.rs::chain_segments` (`chain.first()/last()` — the vec is seeded with 2 elements and never shrinks below that); ~14 `zs[i].unwrap()`/`vzs[i].unwrap()` sites in `classify.rs` (each is inside a branch that already checked `.is_some()` on that exact index via `has_production`/`has_schedule`/`has_v_prod`/`has_v_sched`); the `present_indices`/`ref_surface` unwraps in `classify.rs` (index drawn from a list already filtered to `is_some()`); `boundary.rs`'s outer `max_by(...).unwrap()` (guarded by an `is_empty()` check immediately above).
- **New tests** (8, all passing, engine now at 75 total / 2 ignored): `format::rejects_nan_coordinate`, `format::rejects_infinite_coordinate`, `types::validate_accepts_well_formed_surface`, `types::validate_rejects_out_of_bounds_index`, `types::validate_rejects_nan_vertex`, `types::validate_rejects_infinite_vertex`, `bvh::build_does_not_panic_on_zero_triangles`, `bvh::build_does_not_panic_on_nan_centroid`.
- **Frontend error surfacing verified, no change needed:** `App.tsx`'s catch blocks (`e instanceof Error ? e.message : String(e)` and `e.message || String(e)`) already correctly fall back to `String(e)` for a thrown WASM `JsValue::from_str` (a raw JS string, not an `Error` instance, so `.message` is undefined) — the full descriptive Rust error text reaches the user, it isn't swallowed in favor of something generic.
- **Not fixed here (out of scope, computation logic untouched):** `intersect.rs::chain_segments` has a block of contradictory inline comments around lines 240–249 ("Actually we want to extend... No: ... Let me fix...") suggesting the chain-direction logic may have an unresolved bug — flagged for a future session, not touched, since this session is panic-safety only.
- wasm binary size: 349,621 → 353,692 bytes (+4,071 bytes, +1.2%) for the panic hook + validation logic.

### Master Priority 3 — Remove the orphaned duplicate prototype app
- **Confirmed unused before deleting anything:** the only GitHub Actions workflow (`deploy.yml`) exclusively runs `working-directory: crates/spatial-engine` and `working-directory: web` — it never references root `src/`, root `index.html`, root `vite.config.ts`, root `package.json`, or root `tsconfig.json`. Grepped `web/src` for any import of `../src` or `@/` and found none; `web/package.json`'s only relative dependency is `"spatial-engine": "file:../crates/spatial-engine/pkg"` (the WASM build output, unrelated to the root prototype). Root `package.json` was a fully separate npm project (name `spatial-compliance`, its own React/Vite deps) with no reference to or from `web/`.
- **Deleted:** root `/src` (14 files — `App.tsx`, `engine/`, `parsers/vulcan-oot.ts`, `viewer/`, `compliance/`, `components/`), root `/index.html`, root `/vite.config.ts`, root `/package.json`, root `/package-lock.json`, root `/tsconfig.json`.
- **Left untouched:** `web/`, `crates/`, `docs/`, `scripts/`, `CLAUDE.md`, `README.md` (neither file referenced the old root structure, so no additional edits were needed there).
- **Verified the real deploy path still works post-deletion:** rebuilt `crates/spatial-engine/pkg` via `wasm-pack build --release`, then from `web/`: `npm ci && npx vite build` completed successfully (1,270 modules transformed, `dist/` produced with the WASM asset bundled correctly).

### Master Priority 4 — Fix the waterfall chart totals bug
- **Root cause found:** `WaterfallChart.tsx`'s `buildWaterfallData()` treated `MinedBeforeStart`/`DumpedBeforeStart` as an addition to the running total (`sign: 1`) and left it out of the initial "Planned" bar entirely. The Rust-authoritative formula in `classify.rs`'s `classify_conformance()` (`ConformanceSummary.total_planned_volume`/`total_actual_volume`, also what the live sidebar in `LayerPanel.tsx` and the PPTX donut gauges in `pptxReport.ts` display) is:
  - `total_planned_volume = PlannedAndMined + PlannedNotMined + MinedBeforeStart`
  - `total_actual_volume = PlannedAndMined + MinedNotPlanned + PrescheduleDelay + AheadOfPlan`

  `MinedBeforeStart` belongs to the **planned baseline** (progress already made before the period started), not to actual/production — the waterfall was both omitting it from "Planned" and then adding it on the wrong side of the ledger when stepping toward "Production", inflating the final total by `2 × MinedBeforeStart` relative to `total_actual_volume` whenever that domain was non-zero.
- **Fix:** `planned` now includes `MinedBeforeStart`/`DumpedBeforeStart`; its step sign flipped from `+1` to `-1` (subtracted on the way from Planned to Production, matching Rust's domain sets exactly). Also fixed the same bug's sibling in `pptxReport.ts`'s per-pit slide data builder — its local `planned`/`actual` sums had the identical gap (missing `MinedBeforeStart` from planned; missing `PrescheduleDelay`+`AheadOfPlan` from actual), which would have made the per-pit donut gauges/PPTX text disagree with both the fixed waterfall and the site-wide `result.summary` numbers on the same slide. `hasProduction`'s check was also widened to include `MinedBeforeStart`/`PrescheduleDelay`/`AheadOfPlan` (it previously missed cases where a site had only those domains, which could mislabel or skip the final bar).
- **Verification:** no frontend test runner exists yet (that's a separate item, P18/"Add frontend test coverage") — instead ran a standalone reproducible check (duplicating the exact fixed logic, since it has no external deps) against 5 synthetic domain-volume scenarios in both dig and dump mode, asserting the waterfall's "Planned" and final "Production" bars equal `total_planned_volume`/`total_actual_volume` computed the same way `classify.rs` computes them. Re-ran the identical check against the pre-fix logic first to confirm the test actually catches the bug: **3 of 5 cases mismatched before the fix** (any case with non-zero `MinedBeforeStart`/`PrescheduleDelay`/`AheadOfPlan`), **0 of 5 after**. A proper Vitest regression test for `buildWaterfallData()` (this exact scenario) should be added when P18 sets up the test runner — noted there isn't one yet rather than skipping verification.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly with no new errors from this change.

### Master Priority 5 — Fix the broken polygon draw tool
- **Root cause found:** `DrawingLayer` in `Viewer.tsx` caught clicks via an invisible `THREE.PlaneGeometry(100000, 100000)` mesh positioned at world origin (`position={[0, 0, displayZ]}`). Mine surfaces render at their raw Easting/Northing coordinates with no recentering anywhere in the frontend (confirmed: no offset/recenter logic exists in `web/src`) — CLAUDE.md's own sample data sits around (782000, 7331000), and the camera is positioned at those same real coordinates (`camera.position.set(center.x, ...)` in the fit/preset logic). A 100,000-unit plane centered at (0, 0) is nowhere near a mine site 700+ km away in Easting, so the plane the tool depended on could never actually be hit by a raycast from the camera toward the visible terrain — the tool did nothing, by construction, for any real-world mine coordinate set.
- **Fix:** replaced the flat-plane approach with the same real-mesh raycasting pattern already used (and presumably working, though unverified) by `MeasureClickHandler` — a native `click` listener on the canvas that raycasts against the actual visible scene meshes via `THREE.Raycaster`. Every mesh with a computed `.boundsTree` already gets three-mesh-bvh-accelerated raycasting for free via the `THREE.Mesh.prototype.raycast = acceleratedRaycast` override already at the top of `Viewer.tsx` — this satisfies CLAUDE.md's "Raycasting via three-mesh-bvh only" without a separate mechanism.
  - Registered the listener in the **capture phase** with `stopPropagation()` — otherwise a click meant to place a draw point would also bubble to a surface's own `onClick` (its selection tooltip) underneath the cursor, since both listeners sit on the same canvas element.
  - Preserved the exact prior UX: double-click-within-350ms-to-finish (only once `points.length >= 3`, matching the original behavior precisely), Escape/Enter/Ctrl+Z handling in `App.tsx` untouched (it never depended on the raycasting mechanism).
- **Visually and interactively verified** (dev server + Playwright + headless Chromium/SwiftShader, per CLAUDE.md's own `scripts/visual-check.mjs` harness): generated test surfaces via `cargo run --bin gen-test-surfaces`, loaded 2 surfaces, ran conformance, activated Draw Polygon, and dispatched 4 real `mouse.click()` events on the canvas. Confirmed via a temporary diagnostic (removed before commit) that the scene had 0 real hits before toggling a domain visible (an unrelated discovery, see below) and 2 real raycaster hits per click once a domain was shown; the "Close Polygon" button (disabled until `drawPoints.length >= 3`) correctly enabled after the 3rd click; closing produced a named boundary region that appears in the Boundaries panel with a working remove (×) affordance. Screenshot confirms the domain solids and the drawn 4-point boundary outline render correctly (`visual-check/` output, gitignored).
- **Unrelated discovery, not fixed here (out of scope for this item):** result domains are **hidden by default** after a conformance run (`visible` state starts as an empty `Set` and isn't auto-populated from `res.domains`) — a fresh run shows nothing in the 3D viewport until the user manually clicks each domain row in the sidebar. This is a real usability gap (a first-time user could reasonably think the whole viewer is broken) but is unrelated to polygon drawing specifically — flagging it as a candidate for a future action-list item rather than fixing it in this session.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

### Master Priority 6 — Replace EdgesGeometry with a shader-based wireframe
- **Confirmed the violation:** `CreaseEdges` in `Viewer.tsx` called `new THREE.EdgesGeometry(geometry, CREASE_THRESHOLD_DEG)` directly at 3 call sites (surfaces, batched domain groups, reference layers) — banned outright by this file's own standing rule.
- **Replacement approach (the task's first-choice option, not the "full wireframe" fallback):** a barycentric-coordinate wireframe shader gated per-edge by a precomputed crease flag, so only genuine angle-threshold creases draw — not every triangle edge.
  - One CPU pass over the source triangles (`buildCreaseGeometry`, cached via `useMemo` keyed on `geometry`, same caching discipline as the code it replaces) builds face normals and an edge-adjacency map to decide, per triangle-edge, whether the dihedral angle with its neighbor exceeds `CREASE_THRESHOLD_DEG` (boundary edges — used by only one triangle — always count as creases, matching `EdgesGeometry`'s own behavior). The **output is a fixed, bounded size**: exactly 3 vertices per source triangle with a `barycentric` and a `creaseMask` attribute — unlike `EdgesGeometry`, whose output size is an unpredictable fraction of the edge count (the actual "crashes on large meshes" risk).
  - A small custom `THREE.ShaderMaterial` renders the crease lines entirely in the fragment shader (`fwidth`-based anti-aliased barycentric distance-to-edge, each of the 3 components independently gated by `creaseMask` so non-crease edges are forced to never draw) — no `lineSegments` geometry, no CPU-side line generation, no dependency on the base mesh's own (smooth) normals.
  - Reuses the base material's existing `polygonOffset` (pushes the solid surface slightly away from the camera) so the crease overlay — a normal filled-triangle mesh at native depth — renders cleanly on top without its own offset or z-fighting.
  - Added disposal (`useEffect` cleanup) for both the geometry and the material this code creates.
- **Preserved exact prior visual behavior:** `CREASE_THRESHOLD_DEG` (18°) unchanged, edge colors (`EDGE_COLOR_DARK`/`EDGE_COLOR_LIGHT`) unchanged and still reactive to dark/light mode, opacity 0.7 unchanged, and the existing `style.wireframe` visibility toggle unchanged (still just returns `null` when off).
- **`grep -rn "EdgesGeometry" web/src/` confirms zero remaining constructor calls** — the only matches left are comments documenting what was replaced and why.
- **Visually verified** (dev server + Playwright + headless Chromium/SwiftShader): loaded a domain solid, toggled its "Edges" style on, confirmed a clean anti-aliased boundary crease line renders with no page errors — screenshot sent to the user. Then, as a targeted correctness check (not a permanent change), temporarily set `CREASE_THRESHOLD_DEG = 1` and re-rendered: the result changed from a sparse boundary-only outline to a dense near-full mesh pattern covering the whole surface, conclusively proving the dihedral-angle computation is genuinely threshold-responsive rather than always drawing a fixed boundary line — reverted before committing.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

### Master Priority 7 — Wire up the LOD system
- **Confirmed dead code:** `decimateGeometry()` (`web/src/utils/decimation.ts`) had zero call sites anywhere in the app before this change.
- **3 LOD levels, precomputed once per dataset (not per camera check):** LOD 0 = full resolution, LOD 1 = 25% of triangles, LOD 2 = 5% — via a `LOD_RATIOS` constant and a shared `useLodLevel(sphere)` hook, wired into both `SurfaceMesh` and `BatchedDomainGroup`.
  - **Thresholds are relative to each mesh's own bounding-sphere radius, not a fixed meter value** — so the same logic scales correctly from a small test surface to a 20km site: full detail within 1.5× the mesh's radius, 25% within 4×, 5% beyond that.
  - **Movement detection:** the camera's position is compared between throttled checks (every 150ms, not every frame); if it moved more than a tiny fraction of the mesh's radius, the effective LOD is floored at 1 (25%) for 400ms after the last detected movement — even if the camera is close. This is what keeps orbit/pan/zoom responsive; it upgrades back to full detail once the camera genuinely stops (matching OrbitControls' damping settling, not just the discrete drag ending).
  - **`BatchedDomainGroup` decimates each solid individually before batching them into the merged geometry** — this is what keeps `triRanges` (used by `findSolid()` for hover/click attribution) correct at every LOD level: each solid's own reduced triangle count still marks out its own range in the merged buffer.
  - **The shader-based crease overlay (Priority 6) now caches per LOD-level geometry identity** (a `Map` inside `CreaseEdges`, not a single-slot `useMemo`) so switching back and forth between LOD levels doesn't repeatedly rebuild the crease geometry for a level already seen.
  - **LOD is bypassed while the thickness heatmap is painted** on a surface — heatmap vertex colors are computed against the full-resolution vertex layout, and re-deriving per-vertex coloring for each decimated LOD level's different vertex layout was judged out of scope; heatmap review is a deliberate, stationary precision check, not casual navigation.
  - Disposal added for all 3 precomputed geometries (and their BVH bounds trees) per surface/domain group.
- **Known limitation, documented rather than silently accepted:** `SurfaceMesh`'s hover tooltip (`getThicknessAtFace`) looks up thickness via `upload.indices` (the full-resolution index buffer). When a decimated LOD is active and the mesh is far away, a hovered `faceIndex` from the decimated mesh doesn't line up with that buffer, so thickness readout could be inaccurate in that specific state (far + hovering). This is narrow — the "close" case (where precise hover matters most) always renders at full resolution by design — and building full face-index remapping across LOD levels was judged not worth the added complexity for this pass.
- **Visually and behaviorally verified** (dev server + Playwright + headless Chromium/SwiftShader): via a temporary diagnostic (removed before commit) confirmed the full lifecycle across real camera interaction — initial far view correctly selects LOD 2, zooming out from a mid-distance correctly transitions LOD 1→2, zooming back in correctly cycles through 2→1→0 as the camera settles, oscillating between 0 (stationary) and 1 (momentarily "moving" between scroll ticks) exactly as designed. Screenshots at both extremes (very far / very close) rendered cleanly with no page errors, no missing geometry, no crashes.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

### Master Priority 8 — Dispose Three.js geometry/materials
- **Audited every `new THREE.*Geometry`/`*Material`/`.clone()` call in `Viewer.tsx`** (a full grep pass, not spot-checking). Found and fixed real, previously-undisposed leaks:
  - **`heatmapGeo` in `SurfaceMesh`** — a full clone of the base geometry plus its own BVH, rebuilt every time the thickness heatmap is toggled or its data changes, never freed. On a real session (load → run → toggle heatmap repeatedly) this leaked a complete duplicate of whatever surface was painted each time.
  - **`RefSurfaceMesh`'s geometry** (reference-layer surfaces) — created via `useMemo`, never disposed at all.
  - **Found and fixed a real bug in my own Priority 7 disposal code**: `(geo as any).boundsTree?.dispose?.()` calls a method that doesn't exist — three-mesh-bvh has no `MeshBVH.dispose()`; the correct call is the prototype-patched `geometry.disposeBoundsTree()` (which just nulls the reference so the BVH's typed arrays become collectable once the geometry itself is disposed). The `?.` made the wrong call a silent no-op — it compiled and ran without error, but freed nothing. Fixed at both call sites (`SurfaceMesh`'s LOD geometries, `BatchedDomainGroup`'s LOD results).
- **Already correctly handled, confirmed rather than assumed:** `SurfaceMesh`/`BatchedDomainGroup`'s precomputed LOD geometries (Priority 7) and `CreaseEdges`' cached per-level crease geometry + its `ShaderMaterial` (Priority 6) — both already had `useEffect` cleanup from when they were introduced this session. `computePerVertexThickness`'s temporary `refGeo` disposes itself synchronously within the same function call (not a leak — never held across renders).
- **Left deliberately un-disposed, not shared geometry:** materials/geometries declared directly as JSX primitives (`<meshPhongMaterial>`, `<sphereGeometry>` for point/measurement markers, drei's `<Line>`) — react-three-fiber disposes these automatically on unmount by default; adding manual disposal for them would be redundant, not safer.
- **Noticed but not fixed here (out of scope — visual-output and hooks-correctness, not memory management):** `RefSurfaceMesh` has an early `if (!surf) return null;` before its `useMemo` call, which is a React Hooks rule violation if `layer.surface` ever toggles defined/undefined across renders for the same component instance. Flagged for a future session rather than fixed now, since this task was scoped to disposal only ("DO NOT change any visual output").
- **Verified via a functional stress test** (dev server + Playwright + headless Chromium/SwiftShader) rather than a GPU-memory benchmark: `performance.memory` only tracks the JS heap, not WebGL buffer memory, so it can't actually observe whether GPU-side geometry/BVH buffers were freed — the meaningful check is that the new cleanup code runs correctly without breaking anything. Ran conformance 6 times in a row (exercises `BatchedDomainGroup` disposing the previous run's 3 LOD geometries each time), toggled the thickness heatmap 6 times (exercises `heatmapGeo`'s new create-then-dispose cycle), and zoomed in/out ~60 times (exercises LOD-level and crease-cache disposal repeatedly) — zero page errors throughout, scene continued rendering correctly at the end.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

### Master Priority 9 — Classified, plain-language error messages
- **Removed the native `alert()`** in `handleFileSelected`'s "no surfaces found" branch — it now `throw`s into the same catch block as every other failure, so it's classified and shown the same way as anything else.
- **New `web/src/utils/errorClassification.ts`** — `classifyError(raw)` pattern-matches known real error strings (from `format.rs`'s `decode_surfaces`, `types.rs`'s `TriSurface::validate` added in Priority 2, `dxf.rs`'s `parse_dxf_polygons`, plus generic JS `JSON.parse`/out-of-memory/WASM-trap patterns) to a `{ title, message, raw }` triple — a short plain-language title, one or two actionable sentences, and the untouched original text. Unrecognized errors fall back to a generic "Something went wrong" bucket with `raw` still preserved — nothing is ever deleted, just not shown first. **This is the table to extend for future error patterns.**
- **"No spatial overlap" is a separate case, not an error-string pattern**: `compute_cut_fill`/`classify_conformance` return an empty-but-valid result when surfaces don't overlap (confirmed via `solid.rs`'s `no_overlap_returns_none` test) rather than throwing — so `classifyEmptyResult(totalVolume, domainCount)` is called after a *successful* run instead, wired into both the worker and non-worker run paths in `App.tsx`.
- **New `ErrorBanner.tsx`** replaces the old `{error && <p className="text-xs text-red-400">...}` (one line of small red text, easy to miss under the Run button in a 240px sidebar) with a fixed-position, dismissible banner at the top of the viewport — visible regardless of sidebar scroll position or which panel is open, styled consistently with the app's existing dark-panel conventions. Includes a "Show details" disclosure for the raw technical text and an explicit dismiss (×) button.
- **`error` state widened from `string | null` to `string | ClassifiedError | null`** — a raw string is classified at render time by `ErrorBanner`; an already-classified object (the empty-result case) is shown as-is. Both `setError` call sites in the existing catch blocks are untouched (still plain strings) — only the display layer changed, per this item's scope.
- **Unrelated discovery, not fixed here:** while tracing the run-success path, found the actual root cause of Priority 5's flagged "domains hidden by default" issue — `handleRun`'s worker path explicitly calls `setVisible(new Set<string>())` after every run (the non-worker fallback path instead auto-populates from `res.domains`, but that path is effectively dead code since `useWorker` is the default). Left as a candidate for a future session since fixing it means changing post-run *behavior*, not just how errors are *displayed*.
- **Visually and functionally verified** (dev server + Playwright + headless Chromium/SwiftShader): uploaded a corrupted `.00t` (all-zero bytes past the header) and confirmed — no native `alert()` fires; the classified banner appears with the correct plain-language title ("This file looks corrupt"); "Show details" reveals the exact raw message ("Vertex count is zero"); dismiss removes it cleanly. Screenshot sent to the user.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

### Master Priority 10 — Validate files before attempting to parse them
- **Confirmed the current supported list** rather than assuming: `handleFileSelected` only branches on `.json` vs. everything-else-treated-as-binary-.00t — there is no third format, and no extension check at all before this change (any file, `.pdf` included, would be handed straight to the binary `.00t` parser and fail deep inside it).
- **New `web/src/utils/fileValidation.ts`** — `validateSurfaceFile(file)`, run at the very start of `handleFileSelected`, before any parsing begins:
  - Extension check against the confirmed supported list (`.00t`, `.json`).
  - For `.00t`: reads only the first 128 bytes (never the whole file) and checks — file is at least header-sized; `vertex_count`/`triangle_count` at their documented offsets are plausible (non-zero, under 200M — catches garbage bytes being misread as counts); and the declared counts' implied file size (`128 + vertex_count×24 + triangle_count×24`) doesn't exceed the actual `file.size` (catches truncated/corrupt downloads). This mirrors `format.rs::decode_surfaces`'s own validation exactly — **while writing it, found and fixed a real inaccuracy in this file's own "File size" formula** (the old text subtracted a nonexistent "8-byte overlap" that doesn't appear anywhere in the actual, empirically-validated Rust implementation — corrected above, in the Vulcan .00t Format Specification section).
  - For `.json`: reads only the first 64 bytes and checks it starts with `{` or `[` — catches "obviously not JSON" (e.g. a renamed `.00t`) before spending time reading and decoding the whole file. `JSON.parse` itself remains the real validation for genuinely JSON-shaped garbage.
  - File size: **warns rather than hard-blocks** beyond 500MB (2× the ~250MB target documented elsewhere in this file) — flagged as a judgment call since the exact ceiling may need tuning; the upload still proceeds automatically. Threshold lives in `SIZE_WARNING_BYTES`.
  - All failures/warnings route through the same `ClassifiedError`/`ErrorBanner` UI from Priority 9 — no new UI pattern introduced.
- **Verified fast and correct** (dev server + Playwright + headless Chromium/SwiftShader): tested a wrong-extension file, a truncated `.00t` (valid header, missing trailing bytes), a `.00t` with garbage/implausible header counts, and a genuinely valid small `.00t` — the three bad cases were each correctly rejected with the right classified message in ~300ms (test overhead, not validation cost — the actual check reads only the 128-byte header slice), and the valid file passed straight through with no error banner and successfully assigned to a role. Screenshot confirms the valid-file case.

### Master Priority 11 — Remove an individually assigned surface
- **`workerRemoveSurface(role)` already existed** in `engineClient.ts` (posts a `removeSurface` message the worker already handles — deletes that role's stored binary/JSON) but had zero call sites before this change, confirming the task's own hint to check before adding a new mechanism.
- **New `handleRemoveSurface(role)` in `App.tsx`**, following the same immutable-Map-copy pattern already used by `handleFileSelected` (`new Map(uploads)` → mutate → `setUploads`): removes the role from `uploads`, `surfaceVisible`, `surfaceStyles`, and `domainMaps`; resets `heatmapMode` if it was painting the removed role; calls `workerRemoveSurface` to discard the worker's stored copy; and **clears `result`/`flatDomains`/`visible`** — a conformance result is a function of every assigned surface, so removing one makes the current result stale by definition rather than something safely patchable in place.
- **New remove (×) button in `UploadZone.tsx`**, replacing the "Drop file" hint in the same spot — visible only when that role has an assigned surface (mirrors the existing conditional styling already used for the "Optional" label). Deliberately **not** hover-only/opacity-gated: CLAUDE.md's own known-issues list flags a prior iOS upload problem, and a hover-revealed button would be unreachable on touch devices entirely — it's always visible once a surface is assigned. `stopPropagation()` on its click keeps it from also triggering the row's own "click to browse for file" handler.
- **Visually and functionally verified** (dev server + Playwright + headless Chromium/SwiftShader): assigned 2 surfaces, ran conformance, clicked the × on one — confirmed no file chooser opened (the stopPropagation works), the slot returned to its empty "Optional/Drop file" state, the assigned count updated, and the stale result was cleared (the "Upload surfaces to get started" placeholder reappeared, exactly as it does before any run). Re-uploaded to the now-empty slot afterward and confirmed it works cleanly (not left in a broken state). Screenshot sent to the user.
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

### Master Priority 12 — Auto-save crash/refresh recovery
- **What's persisted, and the tradeoff decided:** role assignments, `fileName`/`name`/vertex-triangle counts, `mode`, `settings`, `boundaries`, and `comparisonName` are always saved (a few KB). The full parsed `positions`/`indices` typed arrays (the expensive part, up to 250MB × 5 surfaces) are *also* attempted, since they're simultaneously the most expensive to lose and the most valuable to recover — but wrapped so a quota failure falls back to metadata-only for that save rather than losing the whole thing (see `saveSession()` in the new `web/src/utils/sessionPersistence.ts`).
- **IndexedDB, not localStorage** — its typed-array support (no JSON stringify/base64 needed) and much larger practical quota are why the task pointed at it specifically. One fixed-key record in a single object store; a `formatVersion` field lets a future incompatible shape change be detected and discarded rather than crashing on restore.
- **Debounced (2s)** — a `useEffect` in `App.tsx` watches `uploads`/`mode`/`settings`/`boundaries`/`comparisonName` and saves through `debounce()`, so a burst of changes (typing a settings value, drawing a boundary point-by-point) doesn't trigger a save per keystroke.
- **On load, prompts rather than silently restoring or discarding** — a new `RestorePrompt.tsx` shown at the landing page states the saved comparison's name, surface count, and age, with explicit Restore/Discard buttons; Discard also clears the stored session (satisfying the "a way to clear a corrupted/stale session" requirement).
- **Real bug found and fixed before committing**: the first working version restored React's own `uploads` state correctly but never told the Web Worker about the restored surfaces — `Run Conformance` (the worker path, the default) reads from the worker's own internal `storedSurfaceBinaries`/`storedSurfaceJsons` maps, which a plain `setUploads()` never touches. The restored surfaces silently acted as "not provided" to the classifier, producing a spurious "no overlap found" result with no error at all. Fixed by routing each restored surface through `workerParseSurfaceJson()` (the same registration path a normal JSON upload uses) before setting `uploads`, using the worker's own returned data to populate state so it's guaranteed consistent with what the worker actually has stored.
- **Known limitation:** truncated (quota-exceeded) roles are recorded in `truncatedRoles` and surfaced in the restore prompt's copy ("N surfaces will need to be re-attached") but restoring doesn't yet re-prompt the user to pick those files — it just leaves those role slots empty, same as a fresh session. Re-attachment UX would be a reasonable follow-up.
- **Visually and functionally verified** (dev server + Playwright + headless Chromium/SwiftShader): uploaded 2 surfaces, waited for the debounced auto-save, reloaded the page — the restore prompt appeared with the correct comparison name and surface count; clicking Restore brought back the full workspace *and* successfully ran conformance on the restored data (confirmed via the exact same classifier log line as the original run — proof the binary data round-tripped correctly through IndexedDB, not just the metadata); the Discard path correctly cleared the stored session (no prompt on a subsequent reload). Screenshots sent to the user (including the pre-fix broken state, for the record, before the worker-registration bug was caught).
- `npx tsc --noEmit` and `npx vite build` both pass cleanly.

## Conventions
- Push completed work to main branch for deployment
- Tests with #[ignore] for those requiring local .00t files
- All coordinates: Easting, Northing, RL (elevation)
- Triangle indices internally 0-indexed, .00t files use 1-indexed
- Surfaces can be up to 250MB — always consider memory and performance
