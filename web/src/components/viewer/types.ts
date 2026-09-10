// Shared types for the Viewer module (Viewer.tsx + components/viewer/*).
//
// Split out of Viewer.tsx (Priority 19: behavior-preserving file breakup —
// no logic changes) into their own module specifically so MeshRenderers.tsx
// and SceneOverlays.tsx can import them without creating a circular import
// with Viewer.tsx itself (which re-exports the externally-consumed ones —
// see the `export type { ... }` line at the top of Viewer.tsx — so App.tsx's
// existing `import type { ... } from './components/Viewer'` keeps working
// unchanged).
import type * as THREE from 'three';
import type {
  BoundaryRegion,
  SurfaceRole,
  UploadedSurface,
  ObjectStyle,
  MeasureTool,
  ViewPreset,
  ViewerBackground,
  HeatmapMode,
  ReferenceLayer,
} from '../../types';
import type { FlatDomainSolid } from '../../workers/engineClient';

export interface TooltipInfo {
  x: number;
  y: number;
  domain: string;
  volume: number;
  blockName?: string;
  surfaceFileName?: string;
  surfaceRoleLabel?: string;
  thickness?: number;
}

export interface SelectionInfo {
  type: 'domain' | 'surface';
  id: string;
  domain?: string;
  label: string;
  volume?: number;
  blockName?: string;
  surfaceFileName?: string;
  surfaceRole?: string;
  vertexCount?: number;
  triangleCount?: number;
  bbox?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export interface MeasurePoint {
  position: THREE.Vector3;
  screenX: number;
  screenY: number;
}

export interface SavedMeasurement {
  id: number;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  distance: number;
}

export interface DomainGroupProps {
  domain: string;
  solids: FlatDomainSolid[];
  visible: boolean;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  isDark: boolean;
  onHover: (info: TooltipInfo | null) => void;
  onSelect: (id: string, info: SelectionInfo) => void;
}

export interface SurfaceMeshProps {
  upload: UploadedSurface;
  style: ObjectStyle;
  selected: boolean;
  highlighted: boolean;
  isDark: boolean;
  onHover: (info: TooltipInfo | null) => void;
  onSelect: (id: string, info: SelectionInfo) => void;
  domainMap?: Uint8Array;
  domainVisible?: Set<string>;
  heatmapVertexThickness?: Float32Array | null;
  heatmapMode?: HeatmapMode | null;
}

export interface ViewPresetControllerProps {
  preset: ViewPreset | null;
  flatDomains: FlatDomainSolid[];
  uploads: Map<SurfaceRole, UploadedSurface>;
  onDone: () => void;
}

export interface DrawingLayerProps {
  points: [number, number][];
  isDrawing: boolean;
  onAddPoint: (x: number, y: number) => void;
  onFinish: () => void;
  displayZ: number;
  sphereRadius: number;
}

export interface SectionLineOverlayProps {
  sectionLine: [[number, number], [number, number]] | null;
  onChange: (line: [[number, number], [number, number]]) => void;
  isDrawing: boolean;
  onDrawComplete: () => void;
  onDragChange: (dragging: boolean) => void;
  displayZ: number;
  sphereRadius: number;
}

export interface ViewerHandle {
  applyPreset: (preset: ViewPreset) => void;
}

export interface ViewerProps {
  flatDomains: FlatDomainSolid[];
  visible: Set<string>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  boundaries: BoundaryRegion[];
  isDrawing: boolean;
  drawPoints: [number, number][];
  onAddDrawPoint: (x: number, y: number) => void;
  onFinishDrawing: () => void;
  uploads: Map<SurfaceRole, UploadedSurface>;
  surfaceVisible: Set<SurfaceRole>;
  isDrawingSection: boolean;
  sectionLine: [[number, number], [number, number]] | null;
  onSectionLineChange: (line: [[number, number], [number, number]]) => void;
  onSectionDrawComplete: () => void;
  background: ViewerBackground;
  domainStyles: Map<string, ObjectStyle>;
  surfaceStyles: Map<SurfaceRole, ObjectStyle>;
  selectedId: string | null;
  onSelect: (id: string | null, info: SelectionInfo | null) => void;
  measureTool: MeasureTool;
  measurePoints: MeasurePoint[];
  onAddMeasurePoint: (point: MeasurePoint) => void;
  savedMeasurements: SavedMeasurement[];
  showPerf: boolean;
  domainMaps: Map<SurfaceRole, Uint8Array>;
  heatmapMode: HeatmapMode | null;
  refLayers: ReferenceLayer[];
  onRefDrop: (files: FileList) => void;
}
