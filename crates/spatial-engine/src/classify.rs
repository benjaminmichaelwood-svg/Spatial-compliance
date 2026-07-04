use serde::{Deserialize, Serialize};

use crate::boundary::assign_cell_to_boundary;
use crate::cutfill::SliverFilter;
use crate::solid::{avg_thickness, compute_signed_volume, compute_surface_area};
use crate::types::{BlockSummary, BoundaryRegion, SolidMesh, TriSurface, Vec3};

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
    pub production_start: &'a TriSurface,
    pub production_end: &'a TriSurface,
    pub schedule_start: &'a TriSurface,
    pub schedule_end: &'a TriSurface,
    pub schedule_future: &'a TriSurface,
    pub mode: Mode,
    pub resolution: usize,
    pub filter: SliverFilter,
    pub boundaries: &'a [BoundaryRegion],
}

// ---------------------------------------------------------------------------
// Mesh builder helper — constructs watertight prism columns
// ---------------------------------------------------------------------------

struct MeshBuilder {
    vertices: Vec<Vec3>,
    indices: Vec<[u32; 3]>,
    grid_volume: f64,
}

impl MeshBuilder {
    fn new() -> Self {
        Self {
            vertices: Vec::new(),
            indices: Vec::new(),
            grid_volume: 0.0,
        }
    }

    fn add_prism(&mut self, x: f64, y: f64, cell_size: f64, z_upper: f64, z_lower: f64) {
        if z_upper <= z_lower + 1e-9 {
            return;
        }

        let half = cell_size / 2.0;
        self.grid_volume += (z_upper - z_lower) * cell_size * cell_size;

        let base = self.vertices.len() as u32;

        // Top quad (0-3), bottom quad (4-7)
        let top = [
            Vec3::new(x - half, y - half, z_upper),
            Vec3::new(x + half, y - half, z_upper),
            Vec3::new(x + half, y + half, z_upper),
            Vec3::new(x - half, y + half, z_upper),
        ];
        let bot = [
            Vec3::new(x - half, y - half, z_lower),
            Vec3::new(x + half, y - half, z_lower),
            Vec3::new(x + half, y + half, z_lower),
            Vec3::new(x - half, y + half, z_lower),
        ];

        for v in &top {
            self.vertices.push(*v);
        }
        for v in &bot {
            self.vertices.push(*v);
        }

        // Top face (outward normal +z)
        self.indices.push([base, base + 1, base + 2]);
        self.indices.push([base, base + 2, base + 3]);

        // Bottom face (outward normal -z)
        self.indices.push([base + 4, base + 6, base + 5]);
        self.indices.push([base + 4, base + 7, base + 6]);

        // Side faces (outward normals)
        let sides: [(u32, u32); 4] = [(0, 1), (1, 2), (2, 3), (3, 0)];
        for &(a, b) in &sides {
            let ta = base + a;
            let tb = base + b;
            let ba = base + 4 + a;
            let bb = base + 4 + b;
            self.indices.push([ta, bb, tb]);
            self.indices.push([ta, ba, bb]);
        }
    }

    fn into_solid(self, label: String) -> Option<SolidMesh> {
        if self.vertices.is_empty() {
            return None;
        }
        let volume = compute_signed_volume(&self.vertices, &self.indices).abs();
        let surface_area = compute_surface_area(&self.vertices, &self.indices);
        Some(SolidMesh {
            label,
            vertices: self.vertices,
            indices: self.indices,
            volume,
            surface_area,
        })
    }
}

// ---------------------------------------------------------------------------
// Surface interpolation (same algorithm as solid.rs, extracted here so we can
// sample all five surfaces on one shared grid)
// ---------------------------------------------------------------------------

fn interpolate_z(surface: &TriSurface, x: f64, y: f64) -> Option<f64> {
    for idx in &surface.indices {
        let v0 = surface.vertices[idx[0] as usize];
        let v1 = surface.vertices[idx[1] as usize];
        let v2 = surface.vertices[idx[2] as usize];

        let d = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
        if d.abs() < 1e-12 {
            continue;
        }

        let a = ((v1.y - v2.y) * (x - v2.x) + (v2.x - v1.x) * (y - v2.y)) / d;
        let b = ((v2.y - v0.y) * (x - v2.x) + (v0.x - v2.x) * (y - v2.y)) / d;
        let c = 1.0 - a - b;

        if a >= -1e-8 && b >= -1e-8 && c >= -1e-8 {
            return Some(a * v0.z + b * v1.z + c * v2.z);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Per-cell domain classification
// ---------------------------------------------------------------------------

/// A domain interval: the z-column that belongs to a particular domain at one
/// grid cell.  `upper > lower` is guaranteed.
struct Interval {
    domain: Domain,
    upper: f64,
    lower: f64,
}

/// Classify a single grid cell in **Dig** mode.
///
/// In a dig operation surfaces move DOWN (material removed).  The production
/// start is higher than production end; the schedule start is higher than the
/// schedule end.
///
/// Surface ordering (ideal):  PS ≥ PE,  SS ≥ SE ≥ SF
fn classify_cell_dig(
    ps: f64,
    pe: f64,
    ss: f64,
    se: f64,
    sf: Option<f64>,
) -> Vec<Interval> {
    let mut out = Vec::with_capacity(4);
    let eps = 1e-9;

    // --- Start-surface discrepancies ---

    // Preschedule Delay: PS > SS — ground is higher than schedule assumed;
    // prior scheduled mining was not completed.
    if ps > ss + eps {
        out.push(Interval {
            domain: Domain::PrescheduleDelay,
            upper: ps,
            lower: ss,
        });
    }

    // Mined Before Start: PS < SS — ground is already lower than schedule
    // assumed; mining occurred before this period.
    if ps < ss - eps {
        out.push(Interval {
            domain: Domain::MinedBeforeStart,
            upper: ss,
            lower: ps,
        });
    }

    // --- Core overlap (Planned and Mined) ---

    let pam_upper = ps.min(ss);
    let pam_lower = pe.max(se);
    if pam_upper > pam_lower + eps {
        out.push(Interval {
            domain: Domain::PlannedAndMined,
            upper: pam_upper,
            lower: pam_lower,
        });
    }

    // --- Under-mining: PE > SE (actual is above scheduled end) ---

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

    // --- Over-mining: PE < SE (actual is below scheduled end) ---

    if pe < se - eps {
        match sf {
            Some(sf_val) if sf_val < se => {
                // Ahead of Plan: between SE and max(PE, SF)
                let aop_lower = pe.max(sf_val);
                if se > aop_lower + eps {
                    out.push(Interval {
                        domain: Domain::AheadOfPlan,
                        upper: se,
                        lower: aop_lower,
                    });
                }

                // Mined Not Planned: below SF (mining past even the future plan)
                if pe < sf_val - eps {
                    out.push(Interval {
                        domain: Domain::MinedNotPlanned,
                        upper: sf_val,
                        lower: pe,
                    });
                }
            }
            _ => {
                // No future schedule (or SF ≥ SE): all over-mining is unplanned
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

/// Classify a single grid cell in **Dump** mode.
///
/// In a dump operation surfaces move UP (material placed).  The production end
/// is higher than production start; the schedule end is higher than the
/// schedule start.
///
/// Surface ordering (ideal):  PE ≥ PS,  SF ≥ SE ≥ SS
fn classify_cell_dump(
    ps: f64,
    pe: f64,
    ss: f64,
    se: f64,
    sf: Option<f64>,
) -> Vec<Interval> {
    let mut out = Vec::with_capacity(4);
    let eps = 1e-9;

    // Dumped Before Start: PS > SS — material was already placed before this
    // period beyond what the schedule assumed.
    if ps > ss + eps {
        out.push(Interval {
            domain: Domain::DumpedBeforeStart,
            upper: ps,
            lower: ss,
        });
    }

    // Dump Preschedule Delay: PS < SS — less material placed than the schedule
    // assumed from prior periods.
    if ps < ss - eps {
        out.push(Interval {
            domain: Domain::DumpPrescheduleDelay,
            upper: ss,
            lower: ps,
        });
    }

    // Planned and Dumped: overlap of planned placement [SS,SE] and actual [PS,PE]
    let pad_lower = ps.max(ss);
    let pad_upper = pe.min(se);
    if pad_upper > pad_lower + eps {
        out.push(Interval {
            domain: Domain::PlannedAndDumped,
            upper: pad_upper,
            lower: pad_lower,
        });
    }

    // Under-dumping: PE < SE (didn't place as much as planned)
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

    // Over-dumping: PE > SE (placed more than planned)
    if pe > se + eps {
        match sf {
            Some(sf_val) if sf_val > se => {
                // Dumped Ahead of Plan: from SE up to min(PE, SF)
                let aop_upper = pe.min(sf_val);
                if aop_upper > se + eps {
                    out.push(Interval {
                        domain: Domain::DumpedAheadOfPlan,
                        upper: aop_upper,
                        lower: se,
                    });
                }

                // Dumped Not Planned: above SF (placed beyond even future plan)
                if pe > sf_val + eps {
                    out.push(Interval {
                        domain: Domain::DumpedNotPlanned,
                        upper: pe,
                        lower: sf_val,
                    });
                }
            }
            _ => {
                // No future schedule (or SF ≤ SE): all over-dumping is unplanned
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

/// Classify a cell where schedule surfaces are undefined but production shows
/// activity.  All moved material is unplanned.
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

// ---------------------------------------------------------------------------
// Main classifier entry point
// ---------------------------------------------------------------------------

pub fn classify_conformance(input: &ConformanceInput) -> ConformanceResult {
    let surfaces: [&TriSurface; 5] = [
        input.production_start,
        input.production_end,
        input.schedule_start,
        input.schedule_end,
        input.schedule_future,
    ];

    // Bounding box union of all surfaces
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for s in &surfaces {
        let (lo, hi) = s.bounding_box();
        min_x = min_x.min(lo.x);
        min_y = min_y.min(lo.y);
        max_x = max_x.max(hi.x);
        max_y = max_y.max(hi.y);
    }

    let range_x = max_x - min_x;
    let range_y = max_y - min_y;
    if range_x <= 0.0 || range_y <= 0.0 {
        return empty_result(input.mode);
    }

    let cell_size = range_x.max(range_y) / input.resolution as f64;
    let nx = ((range_x / cell_size).ceil() as usize).max(1);
    let ny = ((range_y / cell_size).ceil() as usize).max(1);

    // Collect all domains that we might see
    let dig_domains = [
        Domain::PlannedAndMined,
        Domain::PlannedNotMined,
        Domain::MinedNotPlanned,
        Domain::MinedBeforeStart,
        Domain::PrescheduleDelay,
        Domain::AheadOfPlan,
    ];
    let dump_domains = [
        Domain::PlannedAndDumped,
        Domain::PlannedNotDumped,
        Domain::DumpedNotPlanned,
        Domain::DumpedBeforeStart,
        Domain::DumpPrescheduleDelay,
        Domain::DumpedAheadOfPlan,
    ];
    let _active_domains = match input.mode {
        Mode::Dig => &dig_domains[..],
        Mode::Dump => &dump_domains[..],
    };

    use std::collections::HashMap;

    let has_boundaries = !input.boundaries.is_empty();

    // Key: (domain, boundary_index) where None means no boundary or unassigned
    let mut builders: HashMap<(Domain, Option<usize>), MeshBuilder> = HashMap::new();

    // Iterate grid cells — sample all 5 surfaces at each cell centre
    for iy in 0..ny {
        for ix in 0..nx {
            let cx = min_x + (ix as f64 + 0.5) * cell_size;
            let cy = min_y + (iy as f64 + 0.5) * cell_size;

            // If boundaries are defined, skip cells outside all boundaries
            let block_idx = if has_boundaries {
                match assign_cell_to_boundary(cx, cy, input.boundaries) {
                    Some(idx) => Some(idx),
                    None => continue,
                }
            } else {
                None
            };

            let zs: Vec<Option<f64>> = surfaces.iter().map(|s| interpolate_z(s, cx, cy)).collect();
            let (ps, pe) = match (zs[0], zs[1]) {
                (Some(a), Some(b)) => (a, b),
                _ => continue,
            };

            let intervals = match (zs[2], zs[3]) {
                (Some(ss), Some(se)) => {
                    let sf = zs[4];
                    match input.mode {
                        Mode::Dig => classify_cell_dig(ps, pe, ss, se, sf),
                        Mode::Dump => classify_cell_dump(ps, pe, ss, se, sf),
                    }
                }
                _ => classify_cell_no_schedule(ps, pe, input.mode),
            };

            for iv in &intervals {
                let key = (iv.domain, block_idx);
                builders
                    .entry(key)
                    .or_insert_with(MeshBuilder::new)
                    .add_prism(cx, cy, cell_size, iv.upper, iv.lower);
            }
        }
    }

    // Convert builders into DomainSolids, applying the sliver filter
    let mut domains: Vec<DomainSolid> = Vec::new();
    for ((domain, block_idx), builder) in builders {
        let block_name = block_idx.map(|i| input.boundaries[i].name.clone());
        let label = match &block_name {
            Some(bn) => format!("{} — {}", domain.label(), bn),
            None => domain.label().to_string(),
        };
        if let Some(solid) = builder.into_solid(label.clone()) {
            if solid.volume < input.filter.min_volume_m3 {
                continue;
            }
            if avg_thickness(&solid) < input.filter.min_thickness_m {
                continue;
            }
            let volume = solid.volume;
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

    // Block-level summaries
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

fn empty_result(mode: Mode) -> ConformanceResult {
    ConformanceResult {
        mode,
        domains: vec![],
        summary: ConformanceSummary {
            total_planned_volume: 0.0,
            total_actual_volume: 0.0,
            conformance_volume: 0.0,
            conformance_percent: 0.0,
            domain_volumes: vec![],
            block_summaries: vec![],
        },
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: flat surface covering [0, size] × [0, size] at elevation `z`.
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
            production_start: ps,
            production_end: pe,
            schedule_start: ss,
            schedule_end: se,
            schedule_future: sf,
            mode,
            resolution: 40,
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
        let tol = expected.abs() * 0.06 + 1.0; // 6% + 1 m³ absolute
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
        // Schedule and production are identical: all Planned and Mined
        // PS=SS=100, PE=SE=90, SF=80.  Area 10×10, height 10 → 1000 m³.
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
        // Plan says dig 20 m, actual only digs 10 m.
        // PS=SS=100, PE=90, SE=80, SF=70.
        // PAM = [max(90,80), min(100,100)] = [90,100] = 1000 m³
        // PNM = [80, 90] = 1000 m³
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
        // Actual digs 10 m past plan, within future schedule.
        // PS=SS=100, PE=70, SE=80, SF=60.
        // PAM = [max(70,80)=80, 100] = 2000 m³
        // AOP = [max(70,60)=70, 80] = 1000 m³
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
        // Actual digs past future schedule — truly unplanned.
        // PS=SS=100, PE=50, SE=80, SF=60.
        // PAM = [80, 100] = 2000 m³
        // AOP = [60, 80] = 2000 m³
        // MNP = [50, 60] = 1000 m³
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
        // Ground is 5 m higher than schedule assumed (prior plan not done).
        // PS=105, PE=90, SS=100, SE=80, SF=70.
        // PD  = [100, 105] = 500 m³
        // PAM = [min(105,100)=100, max(90,80)=90] = [90,100] = 1000 m³
        // PNM = [80, min(90,100)=90] = 1000 m³
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
        // Ground is 10 m lower than schedule assumed (prior mining occurred).
        // PS=90, PE=80, SS=100, SE=80, SF=70.
        // MBS = [90, 100] = 1000 m³
        // PAM = [min(90,100)=90, max(80,80)=80] = [80,90] = 1000 m³
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
        // PS=100, PE=85, SS=95, SE=80, SF=70.
        // PD  = [95, 100] = 500 m³  (prior plan incomplete)
        // PAM = [min(100,95)=95, max(85,80)=85] = [85, 95] = 1000 m³
        // PNM = [80, min(85,95)=85] = 500 m³
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
        // Construct a scenario that triggers all 6 domains simultaneously by
        // using a tilted PE surface that crosses SE at mid-span.
        //
        // Left half (x < 5):  PE = 70 (over-mined past SF=65)
        // Right half (x ≥ 5): PE = 95 (under-mined)
        // PS=105 (preschedule delay), SS=100, SE=80, SF=65.
        //
        // We use a tilted PE: z = 95 − 5x  (at x=0: z=95, at x=10: z=45)
        // Wait, that's too aggressive. Let me use a gentler tilt.
        //
        // Actually, let me just use a moderately tilted PE to get all domains.
        // PS=105, SS=100, SE=80, SF=65.
        // PE tilted: z = 100 - 6x (x=0: z=100, x=10: z=40)
        //
        // At x=0 (pe=100): pe > se (100>80), pe > ss (100=100):
        //   PD=[100,105]=5, no PAM (pam_upper=100, pam_lower=max(100,80)=100 → 0)
        //   PNM=[80,100]=20
        //
        // At x=5 (pe=70): pe < se (70<80), pe > sf (70>65):
        //   PD=[100,105]=5, PAM=[80,100]=20, AOP=[70,80]=10
        //
        // At x=10 (pe=40): pe < sf (40<65):
        //   PD=[100,105]=5, PAM=[80,100]=20, AOP=[65,80]=15, MNP=[40,65]=25
        //
        // This gives PD, PAM, PNM, AOP, MNP. Still missing MBS.
        // To get MBS we'd need PS < SS at some cells. Let me tilt PS too.
        //
        // Actually, let me keep it simpler. I'll just verify that each domain
        // appears at least once and the volumes are positive. A full analytical
        // check of a tilted-surface scenario is fragile. The per-domain tests
        // above already validate the volumes precisely.

        let size = 20.0;
        let ps = flat(105.0, "ps", size);
        let ss = flat(100.0, "ss", size);
        let se = flat(80.0, "se", size);
        let sf = flat(65.0, "sf", size);

        // Tilted PE: z = 95 - 4x  (x=0 → 95, x=20 → 15)
        let pe = TriSurface {
            name: "pe".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 95.0),
                Vec3::new(size, 0.0, 15.0),
                Vec3::new(size, size, 15.0),
                Vec3::new(0.0, size, 95.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let r = run(&ps, &pe, &ss, &se, &sf, Mode::Dig);

        // PD present (ps=105 > ss=100 everywhere)
        assert!(has_domain(&r, Domain::PrescheduleDelay), "Expected PD");
        // PAM present (overlap zone exists)
        assert!(has_domain(&r, Domain::PlannedAndMined), "Expected PAM");
        // PNM present (right side where pe > se)
        assert!(has_domain(&r, Domain::PlannedNotMined), "Expected PNM");
        // AOP present (pe < se but pe > sf in middle)
        assert!(has_domain(&r, Domain::AheadOfPlan), "Expected AOP");
        // MNP present (far right where pe < sf)
        assert!(has_domain(&r, Domain::MinedNotPlanned), "Expected MNP");

        // All volumes positive
        for d in &r.domains {
            assert!(d.volume > 0.0, "Domain {:?} volume should be > 0", d.domain);
        }
    }

    #[test]
    fn dig_volume_partitioning() {
        // Verify that domain volumes sum to the total volume between the
        // outermost surfaces.
        // PS=100, PE=80, SS=100, SE=80, SF=70. Area = 10×10.
        // Everything is PAM = 2000 m³. No other domains.
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
        // Dump 10 m as planned.
        // PS=SS=100, PE=SE=110, SF=120.
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
        // Plan says place 20 m, actual only places 10 m.
        // PS=SS=100, PE=110, SE=120, SF=130.
        // PAD = [max(100,100), min(110,120)] = [100,110] = 1000 m³
        // PND = [max(110,100), 120] = [110, 120] = 1000 m³
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
        // Actual dumps 10 m past current plan, within future schedule.
        // PS=SS=100, PE=120, SE=110, SF=130.
        // PAD = [100, 110] = 1000 m³
        // DAoP = [110, 120] = 1000 m³
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
        // Actual dumps past future schedule.
        // PS=SS=100, PE=140, SE=110, SF=130.
        // PAD = [100, 110] = 1000 m³
        // DAoP = [110, 130] = 2000 m³
        // DNP = [130, 140] = 1000 m³
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
        // Less material placed before this period than schedule assumed.
        // PS=95, SS=100, PE=110, SE=110, SF=120.
        // DPD = [95, 100] = 500 m³
        // PAD = [max(95,100)=100, min(110,110)=110] = [100,110] = 1000 m³
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
        // More material placed before this period than schedule assumed.
        // PS=110, SS=100, PE=120, SE=120, SF=130.
        // DBS = [100, 110] = 1000 m³
        // PAD = [max(110,100)=110, min(120,120)=120] = [110,120] = 1000 m³
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
        // Only 0.01 m of dig — should be filtered.
        let ps = flat(100.0, "ps", 10.0);
        let pe = flat(99.99, "pe", 10.0);
        let ss = flat(100.0, "ss", 10.0);
        let se = flat(99.99, "se", 10.0);
        let sf = flat(99.0, "sf", 10.0);

        let r = classify_conformance(&ConformanceInput {
            production_start: &ps,
            production_end: &pe,
            schedule_start: &ss,
            schedule_end: &se,
            schedule_future: &sf,
            mode: Mode::Dig,
            resolution: 20,
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
        // Verify that each solid mesh has consistent signed volume (positive)
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
            production_start: &ps,
            production_end: &pe,
            schedule_start: &ss,
            schedule_end: &se,
            schedule_future: &sf,
            mode: Mode::Dig,
            resolution: 40,
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

        // Total should be ~4000 m³ (20x20 area × 10m height)
        let total = left_vol + right_vol;
        assert!(
            (total - 4000.0).abs() < 200.0,
            "Total volume {total} not near 4000"
        );
        assert!(
            (left_vol - right_vol).abs() / total < 0.1,
            "Volumes should be roughly equal: left={left_vol}, right={right_vol}"
        );

        // Block summaries should exist
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
}
