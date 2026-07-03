export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
}

export interface TriangulatedSurface {
  name: string;
  vertices: Float64Array;
  indices: Uint32Array;
  bounds: BoundingBox;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface GridCell {
  row: number;
  col: number;
  centroidX: number;
  centroidY: number;
  designZ: number | null;
  actualZ: number | null;
}

export interface CutFillResult {
  cutVolume: number;
  fillVolume: number;
  netVolume: number;
  gridCells: GridCell[];
  cutSurface: TriangulatedSurface | null;
  fillSurface: TriangulatedSurface | null;
}

export interface SurfacePair {
  design: TriangulatedSurface;
  actual: TriangulatedSurface;
  label: string;
}
