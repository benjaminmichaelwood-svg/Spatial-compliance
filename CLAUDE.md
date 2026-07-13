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
- **Triangle data:** starts immediately after vertices with 8-byte overlap
  - Each triangle = 24 bytes: 3 × BE u32 (1-indexed vertex indices) + 12 bytes zero padding
- **File size** = 128 + (vertex_count × 24 − 8) + (triangle_count × 24)
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

## Conventions
- Push completed work to main branch for deployment
- Tests with #[ignore] for those requiring local .00t files
- All coordinates: Easting, Northing, RL (elevation)
- Triangle indices internally 0-indexed, .00t files use 1-indexed
- Surfaces can be up to 250MB — always consider memory and performance
