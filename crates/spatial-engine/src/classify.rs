use serde::{Deserialize, Serialize};

use crate::bvh::SurfaceBvh;
use crate::boundary::assign_cell_to_boundary;
use crate::cutfill::SliverFilter;
use crate::solid::{compute_signed_volume, compute_surface_area};
use crate::types::{BlockSummary, BoundaryRegion, SolidMesh, TriSurface, Vec3};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Dig,
    Dump,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Domain {
    PlannedAndMined,
    PlannedNotMined,
    MinedNotPlanned,
    MinedBeforeStart,
    PrescheduleDelay,
    AheadOfPlan,

    PlannedAndDumped,
    PlannedNotDumped,
    DumpedNotPlanned,
    DumpedBeforeStart,
    DumpPrescheduleDelay,
    DumpedAheadOfPlan,
}

impl Domain {
    pub fn index(self) -> u8 {
        match self {
            Domain::PlannedAndMined => 1,
            Domain::PlannedNotMined => 2,
            Domain::MinedNotPlanned => 3,
            Domain::MinedBeforeStart => 4,
            Domain::PrescheduleDelay => 5,
            Domain::AheadOfPlan => 6,
            Domain::PlannedAndDumped => 7,
            Domain::PlannedNotDumped => 8,
            Domain::DumpedNotPlanned => 9,
            Domain::DumpedBeforeStart => 10,
            Domain::DumpPrescheduleDelay => 11,
            Domain::DumpedAheadOfPlan => 12,
        }
    }

    pub fn color(self) -> &'static str {
        match self {
            Domain::PlannedAndMined => "#4CAF50",
            Domain::PlannedNotMined => "#FFEB3B",
            Domain::MinedNotPlanned => "#F44336",
            Domain::MinedBeforeStart => "#9C27B0",
            Domain::PrescheduleDelay => "#FF9800",
            Domain::AheadOfPlan => "#2196F3",

            Domain::PlannedAndDumped => "#66BB6A",
            Domain::PlannedNotDumped => "#FFF176",
            Domain::DumpedNotPlanned => "#EF5350",
            Domain::DumpedBeforeStart => "#AB47BC",
            Domain::DumpPrescheduleDelay => "#FFA726",
            Domain::DumpedAheadOfPlan => "#42A5F5",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Domain::PlannedAndMined => "Planned and Mined",
            Domain::PlannedNotMined => "Planned Not Mined",
            Domain::MinedNotPlanned => "Mined Not Planned",
            Domain::MinedBeforeStart => "Mined Before Start",
            Domain::PrescheduleDelay => "Preschedule Delay",
            Domain::AheadOfPlan => "Ahead of Plan",

            Domain::PlannedAndDumped => "Planned and Dumped",
            Domain::PlannedNotDumped => "Planned Not Dumped",
            Domain::DumpedNotPlanned => "Dumped Not Planned",
            Domain::DumpedBeforeStart => "Dumped Before Start",
            Domain::DumpPrescheduleDelay => "Dump Preschedule Delay",
            Domain::DumpedAheadOfPlan => "Dumped Ahead of Plan",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainSolid {
    pub domain: Domain,
    pub label: String,
    pub color: String,
    pub solid: SolidMesh,
    pub volume: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConformanceResult {
    pub mode: Mode,
    pub domains: Vec<DomainSolid>,
    pub summary: ConformanceSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConformanceSummary {
    pub total_planned_volume: f64,
    pub total_actual_volume: f64,
    pub conformance_volume: f64,
    pub conformance_percent: f64,
    pub domain_volumes: Vec<(String, f64)>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub block_summaries: Vec<BlockSummary>,
}

// ---------------------------------------------------------------------------
// Input bundle
// ---------------------------------------------------------------------------

pub struct ConformanceInput<'a> {
    pub production_start: Option<&'a TriSurface>,
    pub production_end: Option<&'a TriSurface>,
    pub schedule_start: Option<&'a TriSurface>,
    pub schedule_end: Option<&'a TriSurface>,
    pub schedule_future: Option<&'a TriSurface>,
    pub mode: Mode,
    pub filter: SliverFilter,
    pub boundaries: &'a [BoundaryRegion],
}

// ---------------------------------------------------------------------------
// Shell builder — constructs closed solid shells (top + bottom + side walls)
// ---------------------------------------------------------------------------

struct ShellBuilder {
    // Deduplicated vertices: top shell and bottom shell share XY positions
    top_verts: Vec<Vec3>,
    bot_verts: Vec<Vec3>,
    // Map (x_mm, y_mm) → vertex index (same index in both top_verts and bot_verts)
    xy_map: HashMap<(i64, i64), u32>,
    // Triangles (indices into top_verts/bot_verts)
    triangles: Vec<[u32; 3]>,
}

impl ShellBuilder {
    fn new() -> Self {
        Self {
            top_verts: Vec::new(),
            bot_verts: Vec::new(),
            xy_map: HashMap::new(),
            triangles: Vec::new(),
        }
    }

    /// Get or create a vertex index for the given XY position.
    /// Stores the upper Z in top_verts and lower Z in bot_verts.
    /// If the vertex already exists, updates Z to the average (handles slight
    /// interpolation differences at shared edges).
    fn get_or_add_vertex(&mut self, x: f64, y: f64, z_top: f64, z_bot: f64) -> u32 {
        let key = ((x * 1000.0).round() as i64, (y * 1000.0).round() as i64);
        match self.xy_map.get(&key) {
            Some(&idx) => {
                // Vertex exists — average Z values for consistency at shared edges
                let i = idx as usize;
                self.top_verts[i].z = (self.top_verts[i].z + z_top) * 0.5;
                self.bot_verts[i].z = (self.bot_verts[i].z + z_bot) * 0.5;
                idx
            }
            None => {
                let idx = self.top_verts.len() as u32;
                self.top_verts.push(Vec3::new(x, y, z_top));
                self.bot_verts.push(Vec3::new(x, y, z_bot));
                self.xy_map.insert(key, idx);
                idx
            }
        }
    }

    /// Add one shell face (one source triangle classified into this domain).
    /// top[0..3] are the upper surface vertices, bot_z[0..3] are the lower Z values.
    fn add_shell_face(&mut self, top: [Vec3; 3], bot_z: [f64; 3]) {
        let z_diff_min = (top[0].z - bot_z[0])
            .min(top[1].z - bot_z[1])
            .min(top[2].z - bot_z[2]);
        if z_diff_min <= 1e-9 {
            return;
        }

        let i0 = self.get_or_add_vertex(top[0].x, top[0].y, top[0].z, bot_z[0]);
        let i1 = self.get_or_add_vertex(top[1].x, top[1].y, top[1].z, bot_z[1]);
        let i2 = self.get_or_add_vertex(top[2].x, top[2].y, top[2].z, bot_z[2]);

        // Degenerate check
        if i0 == i1 || i1 == i2 || i0 == i2 {
            return;
        }

        self.triangles.push([i0, i1, i2]);
    }

    /// Build the final closed solid: top shell + bottom shell + boundary side walls.
    fn into_solid(self, label: String) -> Option<SolidMesh> {
        if self.triangles.is_empty() {
            return None;
        }

        let n_verts = self.top_verts.len();
        let n_tris = self.triangles.len();

        // --- Find boundary edges ---
        // An edge (a, b) normalized as (min, max) appears in exactly one triangle = boundary
        let mut edge_count: HashMap<(u32, u32), u32> = HashMap::with_capacity(n_tris * 3);
        for tri in &self.triangles {
            for &(a, b) in &[(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
                let key = if a < b { (a, b) } else { (b, a) };
                *edge_count.entry(key).or_insert(0) += 1;
            }
        }
        let boundary_edges: Vec<(u32, u32)> = edge_count
            .into_iter()
            .filter(|&(_, count)| count == 1)
            .map(|(edge, _)| edge)
            .collect();

        // --- Assemble the solid mesh ---
        // Vertex layout: [top_verts..., bot_verts...]
        // Top shell indices use 0..n_verts
        // Bottom shell indices use n_verts..2*n_verts
        let bot_offset = n_verts as u32;

        let mut vertices = Vec::with_capacity(n_verts * 2);
        vertices.extend_from_slice(&self.top_verts);
        vertices.extend_from_slice(&self.bot_verts);

        let mut indices = Vec::with_capacity(n_tris * 2 + boundary_edges.len() * 2);

        // Top shell (original winding)
        for tri in &self.triangles {
            indices.push([tri[0], tri[1], tri[2]]);
        }

        // Bottom shell (reversed winding)
        for tri in &self.triangles {
            indices.push([
                tri[0] + bot_offset,
                tri[2] + bot_offset,
                tri[1] + bot_offset,
            ]);
        }

        // Side walls at boundary edges
        for &(a, b) in &boundary_edges {
            let ta = a;           // top vertex a
            let tb = b;           // top vertex b
            let ba = a + bot_offset;  // bottom vertex a
            let bb = b + bot_offset;  // bottom vertex b

            // Two triangles forming a quad between top and bottom edges
            indices.push([ta, bb, tb]);
            indices.push([ta, ba, bb]);
        }

        let volume = compute_signed_volume(&vertices, &indices).abs();
        let surface_area = compute_surface_area(&vertices, &indices);

        Some(SolidMesh {
            label,
            vertices,
            indices,
            volume,
            surface_area,
        })
    }
}

/// Split a solid mesh into connected components via union-find,
/// filter each body independently, and return only the survivors.
fn filter_solid_bodies(solid: SolidMesh, filter: &SliverFilter) -> Vec<SolidMesh> {
    let n = solid.vertices.len();
    if n == 0 {
        return Vec::new();
    }

    // -- Union-Find with path compression and union by rank --
    let mut parent: Vec<usize> = (0..n).collect();
    let mut rank: Vec<u8> = vec![0; n];

    fn find(parent: &mut [usize], mut x: usize) -> usize {
        while parent[x] != x {
            parent[x] = parent[parent[x]]; // path halving
            x = parent[x];
        }
        x
    }

    fn union(parent: &mut [usize], rank: &mut [u8], a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra == rb { return; }
        if rank[ra] < rank[rb] {
            parent[ra] = rb;
        } else {
            parent[rb] = ra;
            if rank[ra] == rank[rb] {
                rank[ra] += 1;
            }
        }
    }

    // -- Bucket vertices by position (1mm precision) to find shared vertices --
    let mut bucket: HashMap<(i64, i64, i64), usize> = HashMap::with_capacity(n);

    for (i, v) in solid.vertices.iter().enumerate() {
        let key = (
            (v.x * 1000.0).round() as i64,
            (v.y * 1000.0).round() as i64,
            (v.z * 1000.0).round() as i64,
        );
        match bucket.get(&key) {
            Some(&existing) => union(&mut parent, &mut rank, i, existing),
            None => { bucket.insert(key, i); }
        }
    }

    // Also union all vertices within each triangle (they're in the same body)
    for tri in &solid.indices {
        union(&mut parent, &mut rank, tri[0] as usize, tri[1] as usize);
        union(&mut parent, &mut rank, tri[1] as usize, tri[2] as usize);
    }

    // -- Group triangles by component root --
    let mut comp_tris: HashMap<usize, Vec<[u32; 3]>> = HashMap::new();
    for tri in &solid.indices {
        let root = find(&mut parent, tri[0] as usize);
        comp_tris.entry(root).or_default().push(*tri);
    }

    // -- Build one SolidMesh per component, filter, keep survivors --
    let label = solid.label;
    let mut result: Vec<SolidMesh> = Vec::new();

    for (_root, tris) in &comp_tris {
        // Remap global vertex indices to compact local indices
        let mut local_map: HashMap<usize, u32> = HashMap::new();
        let mut local_verts: Vec<Vec3> = Vec::new();

        let local_tris: Vec<[u32; 3]> = tris.iter().map(|tri| {
            let mut lt = [0u32; 3];
            for k in 0..3 {
                let gi = tri[k] as usize;
                lt[k] = *local_map.entry(gi).or_insert_with(|| {
                    let idx = local_verts.len() as u32;
                    local_verts.push(solid.vertices[gi]);
                    idx
                });
            }
            lt
        }).collect();

        // Compute volume and surface area
        let volume = compute_signed_volume(&local_verts, &local_tris).abs();
        let surface_area = compute_surface_area(&local_verts, &local_tris);

        // Apply filter
        if volume < filter.min_volume_m3 {
            continue;
        }
        let thickness = if surface_area > 1e-9 { volume / surface_area } else { 0.0 };
        if thickness < filter.min_thickness_m {
            continue;
        }

        result.push(SolidMesh {
            label: label.clone(),
            vertices: local_verts,
            indices: local_tris,
            volume,
            surface_area,
        });
    }

    result
}

/// Merge multiple solid bodies into one SolidMesh for rendering.
fn merge_solid_bodies(bodies: Vec<SolidMesh>, label: String) -> SolidMesh {
    let mut all_verts: Vec<Vec3> = Vec::new();
    let mut all_tris: Vec<[u32; 3]> = Vec::new();
    let mut total_vol = 0.0;
    let mut total_area = 0.0;

    for body in bodies {
        let offset = all_verts.len() as u32;
        all_verts.extend(body.vertices);
        for tri in body.indices {
            all_tris.push([tri[0] + offset, tri[1] + offset, tri[2] + offset]);
        }
        total_vol += body.volume;
        total_area += body.surface_area;
    }

    SolidMesh {
        label,
        vertices: all_verts,
        indices: all_tris,
        volume: total_vol,
        surface_area: total_area,
    }
}

// ---------------------------------------------------------------------------
// Per-cell domain classification (reused from original — these work on Z values)
// ---------------------------------------------------------------------------

struct Interval {
    domain: Domain,
    upper: f64,
    lower: f64,
}

fn classify_cell_dig(
    ps: f64,
    pe: f64,
    ss: f64,
    se: f64,
    sf: Option<f64>,
) -> Vec<Interval> {
    let mut out = Vec::with_capacity(4);
    let eps = 1e-9;

    if ps > ss + eps {
        out.push(Interval {
            domain: Domain::PrescheduleDelay,
            upper: ps,
            lower: ss,
        });
    }

    if ps < ss - eps {
        out.push(Interval {
            domain: Domain::MinedBeforeStart,
            upper: ss,
            lower: ps,
        });
    }

    let pam_upper = ps.min(ss);
    let pam_lower = pe.max(se);
    if pam_upper > pam_lower + eps {
        out.push(Interval {
            domain: Domain::PlannedAndMined,
            upper: pam_upper,
            lower: pam_lower,
        });
    }

    if pe > se + eps {
        let pnm_upper = pe.min(ps.min(ss));
        let pnm_lower = se;
        if pnm_upper > pnm_lower + eps {
            out.push(Interval {
                domain: Domain::PlannedNotMined,
                upper: pnm_upper,
                lower: pnm_lower,
            });
        }
    }

    if pe < se - eps {
        match sf {
            Some(sf_val) if sf_val < se => {
                let aop_lower = pe.max(sf_val);
                if se > aop_lower + eps {
                    out.push(Interval {
                        domain: Domain::AheadOfPlan,
                        upper: se,
                        lower: aop_lower,
                    });
                }
                if pe < sf_val - eps {
                    out.push(Interval {
                        domain: Domain::MinedNotPlanned,
                        upper: sf_val,
                        lower: pe,
                    });
                }
            }
            _ => {
                out.push(Interval {
                    domain: Domain::MinedNotPlanned,
                    upper: se,
                    lower: pe,
                });
            }
        }
    }

    out
}

fn classify_cell_dump(
    ps: f64,
    pe: f64,
    ss: f64,
    se: f64,
    sf: Option<f64>,
) -> Vec<Interval> {
    let mut out = Vec::with_capacity(4);
    let eps = 1e-9;

    if ps > ss + eps {
        out.push(Interval {
            domain: Domain::DumpedBeforeStart,
            upper: ps,
            lower: ss,
        });
    }

    if ps < ss - eps {
        out.push(Interval {
            domain: Domain::DumpPrescheduleDelay,
            upper: ss,
            lower: ps,
        });
    }

    let pad_lower = ps.max(ss);
    let pad_upper = pe.min(se);
    if pad_upper > pad_lower + eps {
        out.push(Interval {
            domain: Domain::PlannedAndDumped,
            upper: pad_upper,
            lower: pad_lower,
        });
    }

    if pe < se - eps {
        let pnd_lower = pe.max(ps.max(ss));
        let pnd_upper = se;
        if pnd_upper > pnd_lower + eps {
            out.push(Interval {
                domain: Domain::PlannedNotDumped,
                upper: pnd_upper,
                lower: pnd_lower,
            });
        }
    }

    if pe > se + eps {
        match sf {
            Some(sf_val) if sf_val > se => {
                let aop_upper = pe.min(sf_val);
                if aop_upper > se + eps {
                    out.push(Interval {
                        domain: Domain::DumpedAheadOfPlan,
                        upper: aop_upper,
                        lower: se,
                    });
                }
                if pe > sf_val + eps {
                    out.push(Interval {
                        domain: Domain::DumpedNotPlanned,
                        upper: pe,
                        lower: sf_val,
                    });
                }
            }
            _ => {
                out.push(Interval {
                    domain: Domain::DumpedNotPlanned,
                    upper: pe,
                    lower: se,
                });
            }
        }
    }

    out
}

fn classify_cell_no_schedule(ps: f64, pe: f64, mode: Mode) -> Vec<Interval> {
    let eps = 1e-9;
    match mode {
        Mode::Dig if ps > pe + eps => vec![Interval {
            domain: Domain::MinedNotPlanned,
            upper: ps,
            lower: pe,
        }],
        Mode::Dump if pe > ps + eps => vec![Interval {
            domain: Domain::DumpedNotPlanned,
            upper: pe,
            lower: ps,
        }],
        _ => vec![],
    }
}

fn classify_cell_schedule_only(ss: f64, se: f64, mode: Mode) -> Vec<Interval> {
    let eps = 1e-9;
    match mode {
        Mode::Dig if ss > se + eps => vec![Interval {
            domain: Domain::PlannedNotMined,
            upper: ss,
            lower: se,
        }],
        Mode::Dump if se > ss + eps => vec![Interval {
            domain: Domain::PlannedNotDumped,
            upper: se,
            lower: ss,
        }],
        _ => vec![],
    }
}

// ---------------------------------------------------------------------------
// Per-vertex bound helpers — same domain formulas applied at each vertex
// ---------------------------------------------------------------------------

fn per_vertex_bounds_dig(domain: Domain, ps: f64, pe: f64, ss: f64, se: f64, sf: Option<f64>) -> (f64, f64) {
    match domain {
        Domain::PrescheduleDelay => (ps, ss),
        Domain::MinedBeforeStart => (ss, ps),
        Domain::PlannedAndMined => (ps.min(ss), pe.max(se)),
        Domain::PlannedNotMined => (pe.min(ps.min(ss)), se),
        Domain::MinedNotPlanned => {
            match sf {
                Some(sf_val) if sf_val < se => (sf_val, pe),
                _ => (se, pe),
            }
        }
        Domain::AheadOfPlan => {
            match sf {
                Some(sf_val) if sf_val < se => (se, pe.max(sf_val)),
                _ => (se, pe),
            }
        }
        _ => (0.0, 0.0),
    }
}

fn per_vertex_bounds_dump(domain: Domain, ps: f64, pe: f64, ss: f64, se: f64, sf: Option<f64>) -> (f64, f64) {
    match domain {
        Domain::DumpedBeforeStart => (ps, ss),
        Domain::DumpPrescheduleDelay => (ss, ps),
        Domain::PlannedAndDumped => (pe.min(se), ps.max(ss)),
        Domain::PlannedNotDumped => (se, pe.max(ps.max(ss))),
        Domain::DumpedNotPlanned => {
            match sf {
                Some(sf_val) if sf_val > se => (pe, sf_val),
                _ => (pe, se),
            }
        }
        Domain::DumpedAheadOfPlan => {
            match sf {
                Some(sf_val) if sf_val > se => (pe.min(sf_val), se),
                _ => (pe, se),
            }
        }
        _ => (0.0, 0.0),
    }
}

// ---------------------------------------------------------------------------
// Main classifier entry point — mesh-based iteration via BVH
// ---------------------------------------------------------------------------

pub fn classify_conformance(input: &ConformanceInput) -> ConformanceResult {
    let opt_surfaces: [Option<&TriSurface>; 5] = [
        input.production_start,
        input.production_end,
        input.schedule_start,
        input.schedule_end,
        input.schedule_future,
    ];

    let bvhs: [Option<SurfaceBvh>; 5] = [
        opt_surfaces[0].map(SurfaceBvh::build),
        opt_surfaces[1].map(SurfaceBvh::build),
        opt_surfaces[2].map(SurfaceBvh::build),
        opt_surfaces[3].map(SurfaceBvh::build),
        opt_surfaces[4].map(SurfaceBvh::build),
    ];

    let has_boundaries = !input.boundaries.is_empty();

    let mut builders: HashMap<(Domain, Option<usize>), ShellBuilder> = HashMap::new();

    let mut present_indices: Vec<usize> = (0..5).filter(|&i| opt_surfaces[i].is_some()).collect();
    present_indices.sort_by(|&a, &b| {
        opt_surfaces[b].unwrap().num_triangles().cmp(&opt_surfaces[a].unwrap().num_triangles())
    });

    let mut processed_surfaces: Vec<usize> = Vec::new();

    for &si in &present_indices {
        let ref_surface = opt_surfaces[si].unwrap();

        for ti in 0..ref_surface.num_triangles() {
            let tri = ref_surface.triangle(ti);
            let cx = (tri.v0.x + tri.v1.x + tri.v2.x) / 3.0;
            let cy = (tri.v0.y + tri.v1.y + tri.v2.y) / 3.0;

            let already_covered = processed_surfaces.iter().any(|&prev_si| {
                bvhs[prev_si]
                    .as_ref()
                    .map_or(false, |b| b.interpolate_z(cx, cy).is_some())
            });
            if already_covered {
                continue;
            }

            let block_idx = if has_boundaries {
                match assign_cell_to_boundary(cx, cy, input.boundaries) {
                    Some(idx) => Some(idx),
                    None => continue,
                }
            } else {
                None
            };

            let zs: [Option<f64>; 5] = [
                if si == 0 { Some((tri.v0.z + tri.v1.z + tri.v2.z) / 3.0) } else { bvhs[0].as_ref().and_then(|b| b.interpolate_z(cx, cy)) },
                if si == 1 { Some((tri.v0.z + tri.v1.z + tri.v2.z) / 3.0) } else { bvhs[1].as_ref().and_then(|b| b.interpolate_z(cx, cy)) },
                if si == 2 { Some((tri.v0.z + tri.v1.z + tri.v2.z) / 3.0) } else { bvhs[2].as_ref().and_then(|b| b.interpolate_z(cx, cy)) },
                if si == 3 { Some((tri.v0.z + tri.v1.z + tri.v2.z) / 3.0) } else { bvhs[3].as_ref().and_then(|b| b.interpolate_z(cx, cy)) },
                if si == 4 { Some((tri.v0.z + tri.v1.z + tri.v2.z) / 3.0) } else { bvhs[4].as_ref().and_then(|b| b.interpolate_z(cx, cy)) },
            ];

            let has_production = zs[0].is_some() && zs[1].is_some();
            let has_schedule = zs[2].is_some() && zs[3].is_some();

            let intervals = if has_production && has_schedule {
                let (ps, pe) = (zs[0].unwrap(), zs[1].unwrap());
                let (ss, se) = (zs[2].unwrap(), zs[3].unwrap());
                let sf = zs[4];
                match input.mode {
                    Mode::Dig => classify_cell_dig(ps, pe, ss, se, sf),
                    Mode::Dump => classify_cell_dump(ps, pe, ss, se, sf),
                }
            } else if has_production {
                let (ps, pe) = (zs[0].unwrap(), zs[1].unwrap());
                classify_cell_no_schedule(ps, pe, input.mode)
            } else if has_schedule {
                let (ss, se) = (zs[2].unwrap(), zs[3].unwrap());
                classify_cell_schedule_only(ss, se, input.mode)
            } else {
                continue;
            };

            let tri_area_2d = ((tri.v1.x - tri.v0.x) * (tri.v2.y - tri.v0.y)
                - (tri.v1.y - tri.v0.y) * (tri.v2.x - tri.v0.x))
                .abs()
                * 0.5;
            if tri_area_2d < 1e-12 {
                continue;
            }

            let verts = [tri.v0, tri.v1, tri.v2];
            let per_vertex_zs: [[Option<f64>; 5]; 3] = verts.map(|v| {
                [
                    if si == 0 { Some(v.z) } else { bvhs[0].as_ref().and_then(|b| b.interpolate_z(v.x, v.y)) },
                    if si == 1 { Some(v.z) } else { bvhs[1].as_ref().and_then(|b| b.interpolate_z(v.x, v.y)) },
                    if si == 2 { Some(v.z) } else { bvhs[2].as_ref().and_then(|b| b.interpolate_z(v.x, v.y)) },
                    if si == 3 { Some(v.z) } else { bvhs[3].as_ref().and_then(|b| b.interpolate_z(v.x, v.y)) },
                    if si == 4 { Some(v.z) } else { bvhs[4].as_ref().and_then(|b| b.interpolate_z(v.x, v.y)) },
                ]
            });

            for iv in &intervals {
                let key = (iv.domain, block_idx);
                let mut top = [Vec3::new(0.0, 0.0, 0.0); 3];
                let mut bot_z = [0.0; 3];
                let mut valid = true;

                for vi in 0..3 {
                    let v = verts[vi];
                    let vzs = per_vertex_zs[vi];

                    let has_v_prod = vzs[0].is_some() && vzs[1].is_some();
                    let has_v_sched = vzs[2].is_some() && vzs[3].is_some();

                    if has_v_prod && has_v_sched {
                        let (upper, lower) = match input.mode {
                            Mode::Dig => per_vertex_bounds_dig(
                                iv.domain, vzs[0].unwrap(), vzs[1].unwrap(),
                                vzs[2].unwrap(), vzs[3].unwrap(), vzs[4],
                            ),
                            Mode::Dump => per_vertex_bounds_dump(
                                iv.domain, vzs[0].unwrap(), vzs[1].unwrap(),
                                vzs[2].unwrap(), vzs[3].unwrap(), vzs[4],
                            ),
                        };
                        if upper > lower + 1e-9 {
                            top[vi] = Vec3::new(v.x, v.y, upper);
                            bot_z[vi] = lower;
                        } else {
                            top[vi] = Vec3::new(v.x, v.y, iv.upper);
                            bot_z[vi] = iv.lower;
                        }
                    } else if has_v_prod {
                        let (vps, vpe) = (vzs[0].unwrap(), vzs[1].unwrap());
                        match input.mode {
                            Mode::Dig if vps > vpe + 1e-9 => {
                                top[vi] = Vec3::new(v.x, v.y, vps);
                                bot_z[vi] = vpe;
                            }
                            Mode::Dump if vpe > vps + 1e-9 => {
                                top[vi] = Vec3::new(v.x, v.y, vpe);
                                bot_z[vi] = vps;
                            }
                            _ => {
                                top[vi] = Vec3::new(v.x, v.y, iv.upper);
                                bot_z[vi] = iv.lower;
                            }
                        }
                    } else if has_v_sched {
                        let (vss, vse) = (vzs[2].unwrap(), vzs[3].unwrap());
                        match input.mode {
                            Mode::Dig if vss > vse + 1e-9 => {
                                top[vi] = Vec3::new(v.x, v.y, vss);
                                bot_z[vi] = vse;
                            }
                            Mode::Dump if vse > vss + 1e-9 => {
                                top[vi] = Vec3::new(v.x, v.y, vse);
                                bot_z[vi] = vss;
                            }
                            _ => {
                                top[vi] = Vec3::new(v.x, v.y, iv.upper);
                                bot_z[vi] = iv.lower;
                            }
                        }
                    } else {
                        valid = false;
                        break;
                    }
                }

                if !valid {
                    let top_fallback = [
                        Vec3::new(verts[0].x, verts[0].y, iv.upper),
                        Vec3::new(verts[1].x, verts[1].y, iv.upper),
                        Vec3::new(verts[2].x, verts[2].y, iv.upper),
                    ];
                    let bot_fallback = [iv.lower, iv.lower, iv.lower];
                    builders.entry(key).or_insert_with(ShellBuilder::new).add_shell_face(top_fallback, bot_fallback);
                } else {
                    builders.entry(key).or_insert_with(ShellBuilder::new).add_shell_face(top, bot_z);
                }
            }
        }

        processed_surfaces.push(si);
    }

    // Convert builders into DomainSolids, splitting connected components
    // and filtering each body independently before merging survivors.
    let mut domains: Vec<DomainSolid> = Vec::new();
    for ((domain, block_idx), builder) in builders {
        let block_name = block_idx.map(|i| input.boundaries[i].name.clone());
        let label = match &block_name {
            Some(bn) => format!("{} — {}", domain.label(), bn),
            None => domain.label().to_string(),
        };

        if let Some(solid) = builder.into_solid(label.clone()) {
            let bodies = filter_solid_bodies(solid, &input.filter);
            if bodies.is_empty() {
                continue;
            }
            let volume: f64 = bodies.iter().map(|b| b.volume).sum();
            let solid = merge_solid_bodies(bodies, label.clone());

            domains.push(DomainSolid {
                domain,
                label,
                color: domain.color().to_string(),
                solid,
                volume,
                block_name,
            });
        }
    }

    // Summary
    let conformance_domain = match input.mode {
        Mode::Dig => Domain::PlannedAndMined,
        Mode::Dump => Domain::PlannedAndDumped,
    };
    let conformance_vol = domains
        .iter()
        .filter(|d| d.domain == conformance_domain)
        .map(|d| d.volume)
        .sum::<f64>();

    let planned_domains: &[Domain] = match input.mode {
        Mode::Dig => &[
            Domain::PlannedAndMined,
            Domain::PlannedNotMined,
            Domain::MinedBeforeStart,
        ],
        Mode::Dump => &[
            Domain::PlannedAndDumped,
            Domain::PlannedNotDumped,
            Domain::DumpedBeforeStart,
        ],
    };

    let actual_domains: &[Domain] = match input.mode {
        Mode::Dig => &[
            Domain::PlannedAndMined,
            Domain::MinedNotPlanned,
            Domain::PrescheduleDelay,
            Domain::AheadOfPlan,
        ],
        Mode::Dump => &[
            Domain::PlannedAndDumped,
            Domain::DumpedNotPlanned,
            Domain::DumpPrescheduleDelay,
            Domain::DumpedAheadOfPlan,
        ],
    };

    let total_planned: f64 = domains
        .iter()
        .filter(|d| planned_domains.contains(&d.domain))
        .map(|d| d.volume)
        .sum();
    let total_actual: f64 = domains
        .iter()
        .filter(|d| actual_domains.contains(&d.domain))
        .map(|d| d.volume)
        .sum();

    let conformance_pct = if total_planned > 1e-6 {
        (conformance_vol / total_planned) * 100.0
    } else {
        0.0
    };

    let domain_volumes: Vec<(String, f64)> = {
        let mut dv: HashMap<String, f64> = HashMap::new();
        for d in &domains {
            *dv.entry(d.domain.label().to_string()).or_insert(0.0) += d.volume;
        }
        dv.into_iter().collect()
    };

    let block_summaries = if has_boundaries {
        let mut block_map: HashMap<String, HashMap<String, f64>> = HashMap::new();
        for d in &domains {
            let bn = d.block_name.clone().unwrap_or_else(|| "Unassigned".into());
            *block_map
                .entry(bn)
                .or_default()
                .entry(d.domain.label().to_string())
                .or_insert(0.0) += d.volume;
        }
        block_map
            .into_iter()
            .map(|(block_name, dv)| {
                let total_volume = dv.values().sum();
                let domain_volumes = dv.into_iter().collect();
                BlockSummary {
                    block_name,
                    domain_volumes,
                    total_volume,
                }
            })
            .collect()
    } else {
        vec![]
    };

    ConformanceResult {
        mode: input.mode,
        domains,
        summary: ConformanceSummary {
            total_planned_volume: total_planned,
            total_actual_volume: total_actual,
            conformance_volume: conformance_vol,
            conformance_percent: conformance_pct,
            domain_volumes,
            block_summaries,
        },
    }
}


// ---------------------------------------------------------------------------
// Per-triangle domain classification for surface painting
// ---------------------------------------------------------------------------

pub fn classify_surface_domains(input: &ConformanceInput) -> Vec<(usize, Vec<u8>, Vec<f32>)> {
    let ref_surface = match input.production_end {
        Some(s) => s,
        None => return Vec::new(),
    };

    let bvhs: [Option<SurfaceBvh>; 5] = [
        input.production_start.map(SurfaceBvh::build),
        None, // production_end IS the ref surface — use its own Z
        input.schedule_start.map(SurfaceBvh::build),
        input.schedule_end.map(SurfaceBvh::build),
        input.schedule_future.map(SurfaceBvh::build),
    ];

    let num_tris = ref_surface.num_triangles();
    let mut domain_map = vec![0u8; num_tris];
    let mut thickness_map = vec![0.0f32; num_tris];

    for ti in 0..num_tris {
        let tri = ref_surface.triangle(ti);
        let cx = (tri.v0.x + tri.v1.x + tri.v2.x) / 3.0;
        let cy = (tri.v0.y + tri.v1.y + tri.v2.y) / 3.0;
        let cz = (tri.v0.z + tri.v1.z + tri.v2.z) / 3.0;

        let zs: [Option<f64>; 5] = [
            bvhs[0].as_ref().and_then(|b| b.interpolate_z(cx, cy)),
            Some(cz),
            bvhs[2].as_ref().and_then(|b| b.interpolate_z(cx, cy)),
            bvhs[3].as_ref().and_then(|b| b.interpolate_z(cx, cy)),
            bvhs[4].as_ref().and_then(|b| b.interpolate_z(cx, cy)),
        ];

        let has_production = zs[0].is_some() && zs[1].is_some();
        let has_schedule = zs[2].is_some() && zs[3].is_some();

        let intervals = if has_production && has_schedule {
            let (ps, pe) = (zs[0].unwrap(), zs[1].unwrap());
            let (ss, se) = (zs[2].unwrap(), zs[3].unwrap());
            let sf = zs[4];
            match input.mode {
                Mode::Dig => classify_cell_dig(ps, pe, ss, se, sf),
                Mode::Dump => classify_cell_dump(ps, pe, ss, se, sf),
            }
        } else if has_production {
            let (ps, pe) = (zs[0].unwrap(), zs[1].unwrap());
            classify_cell_no_schedule(ps, pe, input.mode)
        } else if has_schedule {
            let (ss, se) = (zs[2].unwrap(), zs[3].unwrap());
            classify_cell_schedule_only(ss, se, input.mode)
        } else {
            continue;
        };

        if let Some(best) = intervals.iter().max_by(|a, b| {
            let ta = a.upper - a.lower;
            let tb = b.upper - b.lower;
            ta.partial_cmp(&tb).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            let thick = (best.upper - best.lower).abs();
            if thick > 1e-9 {
                domain_map[ti] = best.domain.index();
                thickness_map[ti] = thick as f32;
            }
        }
    }

    vec![(1, domain_map, thickness_map)]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(z: f64, name: &str, size: f64) -> TriSurface {
        TriSurface {
            name: name.to_string(),
            vertices: vec![
                Vec3::new(0.0, 0.0, z),
                Vec3::new(size, 0.0, z),
                Vec3::new(size, size, z),
                Vec3::new(0.0, size, z),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        }
    }

    fn run(
        ps: &TriSurface,
        pe: &TriSurface,
        ss: &TriSurface,
        se: &TriSurface,
        sf: &TriSurface,
        mode: Mode,
    ) -> ConformanceResult {
        classify_conformance(&ConformanceInput {
            production_start: Some(ps),
            production_end: Some(pe),
            schedule_start: Some(ss),
            schedule_end: Some(se),
            schedule_future: Some(sf),
            mode,
            filter: SliverFilter {
                min_volume_m3: 0.01,
                min_thickness_m: 0.001,
            },
            boundaries: &[],
        })
    }

    fn domain_vol(result: &ConformanceResult, domain: Domain) -> f64 {
        result
            .domains
            .iter()
            .filter(|d| d.domain == domain)
            .map(|d| d.volume)
            .sum()
    }

    fn has_domain(result: &ConformanceResult, domain: Domain) -> bool {
        result.domains.iter().any(|d| d.domain == domain)
    }

    fn assert_vol(actual: f64, expected: f64, label: &str) {
        let tol = expected.abs() * 0.06 + 1.0;
        assert!(
            (actual - expected).abs() < tol,
            "{label}: expected ~{expected:.1}, got {actual:.1}"
        );
    }

    // -----------------------------------------------------------------------
    // DIG MODE TESTS
    // -----------------------------------------------------------------------

    #[test]
    fn dig_perfect_conformance() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(90.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(90.0, "se", 10.0);
        let sf = flat(80.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 1000.0, "PAM");
        assert!(!has_domain(&r, Domain::PlannedNotMined));
        assert!(!has_domain(&r, Domain::MinedNotPlanned));
        assert!(!has_domain(&r, Domain::MinedBeforeStart));
        assert!(!has_domain(&r, Domain::PrescheduleDelay));
        assert!(!has_domain(&r, Domain::AheadOfPlan));
        assert!(
            (r.summary.conformance_percent - 100.0).abs() < 1.0,
            "Conformance should be ~100%, got {:.1}%",
            r.summary.conformance_percent
        );
    }

    #[test]
    fn dig_planned_not_mined() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(90.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(70.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 1000.0, "PAM");
        assert_vol(domain_vol(&r, Domain::PlannedNotMined), 1000.0, "PNM");
        assert!(!has_domain(&r, Domain::AheadOfPlan));
        assert!(!has_domain(&r, Domain::MinedNotPlanned));
    }

    #[test]
    fn dig_ahead_of_plan() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(70.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(60.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 2000.0, "PAM");
        assert_vol(domain_vol(&r, Domain::AheadOfPlan), 1000.0, "AOP");
        assert!(!has_domain(&r, Domain::MinedNotPlanned));
        assert!(!has_domain(&r, Domain::PlannedNotMined));
    }

    #[test]
    fn dig_mined_not_planned() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(50.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(60.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 2000.0, "PAM");
        assert_vol(domain_vol(&r, Domain::AheadOfPlan), 2000.0, "AOP");
        assert_vol(domain_vol(&r, Domain::MinedNotPlanned), 1000.0, "MNP");
    }

    #[test]
    fn dig_preschedule_delay() {
        let ps = flat(105.0, "ps", 10.0);
        let pe = flat(90.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(70.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::PrescheduleDelay), 500.0, "PD");
        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 1000.0, "PAM");
        assert_vol(domain_vol(&r, Domain::PlannedNotMined), 1000.0, "PNM");
    }

    #[test]
    fn dig_mined_before_start() {
        let ps = flat(90.0, "ps", 10.0);
        let pe = flat(80.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(70.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::MinedBeforeStart), 1000.0, "MBS");
        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 1000.0, "PAM");
        assert!(!has_domain(&r, Domain::PlannedNotMined));
    }

    #[test]
    fn dig_combined_preschedule_delay_and_planned_not_mined() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(85.0, "pe", 10.0);
        let ss = flat(95.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(70.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert_vol(domain_vol(&r, Domain::PrescheduleDelay), 500.0, "PD");
        assert_vol(domain_vol(&r, Domain::PlannedAndMined), 1000.0, "PAM");
        assert_vol(domain_vol(&r, Domain::PlannedNotMined), 500.0, "PNM");
    }

    #[test]
    fn dig_all_six_domains() {
        // Use a subdivided PE surface so centroids span the full Z range.
        // PE tilted: z = 95 - 4x across [0,20].
        // Centroids at x≈3.33 (pe≈81.67), x≈6.67 (pe≈68.33), etc.
        // With se=60 and sf=35:
        //   pe>se at left centroids → PNM
        //   pe<se at right centroids → AOP/MNP
        //   ps>ss everywhere → PD
        let size = 20.0;
        let ps = flat(105.0, "ps", size);
        let ss = flat(100.0, "ss", size);
        let se = flat(60.0, "se", size);
        let sf = flat(35.0, "sf", size);

        // Subdivide PE into a strip mesh for finer sampling
        let n = 10;
        let mut pe_verts = Vec::new();
        let mut pe_indices = Vec::new();
        for i in 0..=n {
            let x = size * i as f64 / n as f64;
            let z = 95.0 - 4.0 * x;
            pe_verts.push(Vec3::new(x, 0.0, z));
            pe_verts.push(Vec3::new(x, size, z));
        }
        for i in 0..n {
            let bl = (i * 2) as u32;
            let br = bl + 2;
            let tl = bl + 1;
            let tr = bl + 3;
            pe_indices.push([bl, br, tr]);
            pe_indices.push([bl, tr, tl]);
        }
        let pe = TriSurface {
            name: "pe".into(),
            vertices: pe_verts,
            indices: pe_indices,
        };

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        assert!(has_domain(&r, Domain::PrescheduleDelay), "Expected PD");
        assert!(has_domain(&r, Domain::PlannedAndMined), "Expected PAM");
        assert!(has_domain(&r, Domain::PlannedNotMined), "Expected PNM");
        assert!(has_domain(&r, Domain::AheadOfPlan), "Expected AOP");
        assert!(has_domain(&r, Domain::MinedNotPlanned), "Expected MNP");

        for d in &r.domains {
            assert!(d.volume > 0.0, "Domain {:?} volume should be > 0", d.domain);
        }
    }

    #[test]
    fn dig_volume_partitioning() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(80.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(70.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        let total: f64 = r.domains.iter().map(|d| d.volume).sum();
        assert_vol(total, 2000.0, "total volume");
    }

    #[test]
    fn dig_domain_colors_and_labels() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(90.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(90.0, "se", 10.0);
        let sf = flat(80.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);
        let pam = r.domains.iter().find(|d| d.domain == Domain::PlannedAndMined).unwrap();
        assert_eq!(pam.color, "#4CAF50");
        assert_eq!(pam.label, "Planned and Mined");
    }

    // -----------------------------------------------------------------------
    // DUMP MODE TESTS
    // -----------------------------------------------------------------------

    #[test]
    fn dump_perfect_conformance() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(110.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(110.0, "se", 10.0);
        let sf = flat(120.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dump);

        assert_vol(domain_vol(&r, Domain::PlannedAndDumped), 1000.0, "PAD");
        assert!(!has_domain(&r, Domain::PlannedNotDumped));
        assert!(!has_domain(&r, Domain::DumpedNotPlanned));
    }

    #[test]
    fn dump_planned_not_dumped() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(110.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(120.0, "se", 10.0);
        let sf = flat(130.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dump);

        assert_vol(domain_vol(&r, Domain::PlannedAndDumped), 1000.0, "PAD");
        assert_vol(domain_vol(&r, Domain::PlannedNotDumped), 1000.0, "PND");
    }

    #[test]
    fn dump_ahead_of_plan() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(120.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(110.0, "se", 10.0);
        let sf = flat(130.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dump);

        assert_vol(domain_vol(&r, Domain::PlannedAndDumped), 1000.0, "PAD");
        assert_vol(domain_vol(&r, Domain::DumpedAheadOfPlan), 1000.0, "DAoP");
    }

    #[test]
    fn dump_not_planned() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(140.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(110.0, "se", 10.0);
        let sf = flat(130.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dump);

        assert_vol(domain_vol(&r, Domain::PlannedAndDumped), 1000.0, "PAD");
        assert_vol(domain_vol(&r, Domain::DumpedAheadOfPlan), 2000.0, "DAoP");
        assert_vol(domain_vol(&r, Domain::DumpedNotPlanned), 1000.0, "DNP");
    }

    #[test]
    fn dump_preschedule_delay() {
        let ps = flat(95.0, "ps", 10.0);
        let pe = flat(110.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(110.0, "se", 10.0);
        let sf = flat(120.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dump);

        assert_vol(domain_vol(&r, Domain::DumpPrescheduleDelay), 500.0, "DPD");
        assert_vol(domain_vol(&r, Domain::PlannedAndDumped), 1000.0, "PAD");
    }

    #[test]
    fn dump_before_start() {
        let ps = flat(110.0, "ps", 10.0);
        let pe = flat(120.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(120.0, "se", 10.0);
        let sf = flat(130.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dump);

        assert_vol(domain_vol(&r, Domain::DumpedBeforeStart), 1000.0, "DBS");
        assert_vol(domain_vol(&r, Domain::PlannedAndDumped), 1000.0, "PAD");
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn sliver_filter_removes_thin_domains() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(99.99, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(99.99, "se", 10.0);
        let sf = flat(99.0, "sf", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: Some(&ps),
            production_end: Some(&pe),
            schedule_start: Some(&ss),
            schedule_end: Some(&se),
            schedule_future: Some(&sf),
            mode: Mode::Dig,
            filter: SliverFilter {
                min_volume_m3: 0.5,
                min_thickness_m: 0.05,
            },
            boundaries: &[],
        });

        assert!(
            r.domains.is_empty(),
            "Sliver filter should remove 0.01m-thick domain"
        );
    }

    #[test]
    fn solids_are_watertight() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(85.0, "pe", 10.0);
        let ss = flat(95.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);
        let sf = flat(70.0, "sf", 10.0);

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        for d in &r.domains {
            let signed = compute_signed_volume(&d.solid.vertices, &d.solid.indices);
            assert!(
                signed > 0.0,
                "Domain {:?} has negative signed volume {signed} — normals may be inverted",
                d.domain
            );
        }
    }

    #[test]
    fn boundary_splits_volume() {
        let ps = flat(100.0, "ps", 20.0);
        let pe = flat(90.0, "pe", 20.0);
        let ss = flat(100.0, "ss", 20.0);
        let se = flat(90.0, "se", 20.0);
        let sf = flat(85.0, "sf", 20.0);

        let boundaries = vec![
            BoundaryRegion {
                name: "Left".into(),
                polygon: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 20.0], [0.0, 20.0]],
            },
            BoundaryRegion {
                name: "Right".into(),
                polygon: vec![[10.0, 0.0], [20.0, 0.0], [20.0, 20.0], [10.0, 20.0]],
            },
        ];

        let r = classify_conformance(&ConformanceInput {
            production_start: Some(&ps),
            production_end: Some(&pe),
            schedule_start: Some(&ss),
            schedule_end: Some(&se),
            schedule_future: Some(&sf),
            mode: Mode::Dig,
            filter: SliverFilter {
                min_volume_m3: 0.01,
                min_thickness_m: 0.001,
            },
            boundaries: &boundaries,
        });

        let left_vol: f64 = r
            .domains
            .iter()
            .filter(|d| d.block_name.as_deref() == Some("Left"))
            .map(|d| d.volume)
            .sum();
        let right_vol: f64 = r
            .domains
            .iter()
            .filter(|d| d.block_name.as_deref() == Some("Right"))
            .map(|d| d.volume)
            .sum();

        let total = left_vol + right_vol;
        assert!(
            (total - 4000.0).abs() < 200.0,
            "Total volume {total} not near 4000"
        );
        assert!(
            (left_vol - right_vol).abs() / total < 0.1,
            "Volumes should be roughly equal: left={left_vol}, right={right_vol}"
        );

        assert_eq!(r.summary.block_summaries.len(), 2);
    }

    #[test]
    fn no_boundaries_means_no_block_names() {
        let r = run(
            &flat(100.0, "ps", 10.0),
            &flat(90.0, "pe", 10.0),
            &flat(100.0, "ss", 10.0),
            &flat(90.0, "se", 10.0),
            &flat(85.0, "sf", 10.0),
            Mode::Dig,
        );
        assert!(r.domains.iter().all(|d| d.block_name.is_none()));
        assert!(r.summary.block_summaries.is_empty());
    }

    // -----------------------------------------------------------------------
    // Partial surface tests
    // -----------------------------------------------------------------------

    #[test]
    fn production_only_dig() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(90.0, "pe", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: Some(&ps),
            production_end: Some(&pe),
            schedule_start: None,
            schedule_end: None,
            schedule_future: None,
            mode: Mode::Dig,
            filter: SliverFilter { min_volume_m3: 0.01, min_thickness_m: 0.001 },
            boundaries: &[],
        });

        assert_vol(domain_vol(&r, Domain::MinedNotPlanned), 1000.0, "MNP");
        assert_eq!(r.domains.len(), 1);
    }

    #[test]
    fn schedule_only_dig() {
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(90.0, "se", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: None,
            production_end: None,
            schedule_start: Some(&ss),
            schedule_end: Some(&se),
            schedule_future: None,
            mode: Mode::Dig,
            filter: SliverFilter { min_volume_m3: 0.01, min_thickness_m: 0.001 },
            boundaries: &[],
        });

        assert_vol(domain_vol(&r, Domain::PlannedNotMined), 1000.0, "PNM");
        assert_eq!(r.domains.len(), 1);
    }

    #[test]
    fn production_only_dump() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(110.0, "pe", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: Some(&ps),
            production_end: Some(&pe),
            schedule_start: None,
            schedule_end: None,
            schedule_future: None,
            mode: Mode::Dump,
            filter: SliverFilter { min_volume_m3: 0.01, min_thickness_m: 0.001 },
            boundaries: &[],
        });

        assert_vol(domain_vol(&r, Domain::DumpedNotPlanned), 1000.0, "DNP");
        assert_eq!(r.domains.len(), 1);
    }

    #[test]
    fn schedule_only_dump() {
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(110.0, "se", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: None,
            production_end: None,
            schedule_start: Some(&ss),
            schedule_end: Some(&se),
            schedule_future: None,
            mode: Mode::Dump,
            filter: SliverFilter { min_volume_m3: 0.01, min_thickness_m: 0.001 },
            boundaries: &[],
        });

        assert_vol(domain_vol(&r, Domain::PlannedNotDumped), 1000.0, "PND");
        assert_eq!(r.domains.len(), 1);
    }

    #[test]
    fn four_surfaces_no_future() {
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(70.0, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(80.0, "se", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: Some(&ps),
            production_end: Some(&pe),
            schedule_start: Some(&ss),
            schedule_end: Some(&se),
            schedule_future: None,
            mode: Mode::Dig,
            filter: SliverFilter { min_volume_m3: 0.01, min_thickness_m: 0.001 },
            boundaries: &[],
        });

        assert!(has_domain(&r, Domain::PlannedAndMined), "Expected PAM");
        assert!(has_domain(&r, Domain::MinedNotPlanned), "Expected MNP");
    }

    fn make_large_surface(z_base: f64, name: &str, grid_size: usize) -> TriSurface {
        let step = 10.0;
        let n = grid_size + 1;
        let mut vertices = Vec::with_capacity(n * n);
        for row in 0..n {
            for col in 0..n {
                let x = col as f64 * step;
                let y = row as f64 * step;
                let z = z_base + (x * 0.001).sin() * 2.0 + (y * 0.002).cos() * 1.5;
                vertices.push(Vec3::new(x, y, z));
            }
        }
        let mut indices = Vec::with_capacity(grid_size * grid_size * 2);
        for row in 0..grid_size {
            for col in 0..grid_size {
                let tl = (row * n + col) as u32;
                let tr = tl + 1;
                let bl = tl + n as u32;
                let br = bl + 1;
                indices.push([tl, bl, tr]);
                indices.push([tr, bl, br]);
            }
        }
        TriSurface { name: name.to_string(), vertices, indices }
    }

    #[test]
    fn large_surface_conformance_completes() {
        let grid = 1414; // ~2M triangles per surface
        let ps = make_large_surface(100.0, "ps", grid);
        let pe = make_large_surface(85.0, "pe", grid);
        assert!(ps.indices.len() > 1_900_000, "Need ~2M tris, got {}", ps.indices.len());

        let input = ConformanceInput {
            production_start: Some(&ps),
            production_end: Some(&pe),
            schedule_start: None,
            schedule_end: None,
            schedule_future: None,
            mode: Mode::Dig,
            filter: SliverFilter { min_volume_m3: 1.0, min_thickness_m: 0.1 },
            boundaries: &[],
        };

        let result = classify_conformance(&input);
        assert!(!result.domains.is_empty(), "Should produce at least one domain");
        let total_vol: f64 = result.domains.iter().map(|d| d.volume).sum();
        assert!(total_vol > 0.0, "Total volume should be positive");
    }
}
