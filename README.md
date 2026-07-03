# Mining Spatial Compliance Tool

Web-based spatial compliance analysis tool for open pit mining operations. Compares planned vs actual mining surfaces to classify conformance domains and quantify volumetric compliance.

## Features

- **Vulcan .00t Parser** — Reads Vulcan triangulation files (.00t), plus OBJ and CSV/XYZ fallbacks
- **Cut/Fill Computation** — Grid-based volume comparison between surface pairs with configurable resolution
- **Conformance Domain Classification**:
  - Planned & Mined
  - Mined Not Planned
  - Preschedule Delay
  - Ahead of Plan
  - Mined Before Start
  - Planned Not Mined
  - Plus dump equivalents (Placed Not Planned, etc.)
- **3D Viewer** — Interactive Three.js scene with toggleable domain solids, wireframe overlay, orbit controls
- **Reporting** — Summary statistics, domain breakdown tables, CSV export

## Required Inputs

| Surface | Description |
|---------|-------------|
| Pre-Mining | Original topography before mining |
| Planned End-of-Period | Planned pit design for the compliance period |
| Actual End-of-Period | As-mined survey surface |

Optional: Planned Start-of-Period, Actual Start-of-Period, Planned Dump, Actual Dump.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, upload your surface files, assign roles, and run the analysis.

## Build

```bash
npm run build
npm run preview
```

## Tech Stack

- React + TypeScript
- Three.js (via react-three-fiber / drei)
- Vite
