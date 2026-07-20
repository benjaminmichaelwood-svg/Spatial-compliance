use crate::intersect::{compute_intersection_polyline, chain_segments};
use crate::solid::{avg_thickness, build_solid_between_surfaces};
use crate::types::{CutFillResult, SolidMesh, TriSurface, Vec3};

#[derive(Debug, Clone, Copy)]
pub struct SliverFilter {
    pub min_volume_m3: f64,
    pub min_thickness_m: f64,
    pub min_triangles: usize,
}

impl Default for SliverFilter {
    fn default() -> Self {
        Self {
            min_volume_m3: 1.0,
            min_thickness_m: 0.1,
            min_triangles: 20,
        }
    }
}

pub fn compute_cut_fill(
    surface_a: &TriSurface,
    surface_b: &TriSurface,
    filter: SliverFilter,
) -> CutFillResult {
    let raw_segments = compute_intersection_polyline(surface_a, surface_b);
    let polylines = chain_segments(&raw_segments, 0.01);
    let intersection_polyline: Vec<Vec3> = polylines.into_iter().flatten().collect();

    let cut_solid = build_solid_between_surfaces(surface_a, surface_b, "cut");
    let fill_solid = build_solid_between_surfaces(surface_b, surface_a, "fill");

    let cut_solids = filter_slivers(cut_solid.into_iter().collect(), &filter);
    let fill_solids = filter_slivers(fill_solid.into_iter().collect(), &filter);

    let total_cut = cut_solids.iter().map(|s| s.volume).sum();
    let total_fill = fill_solids.iter().map(|s| s.volume).sum();

    CutFillResult {
        cut_solids,
        fill_solids,
        total_cut_volume: total_cut,
        total_fill_volume: total_fill,
        net_volume: total_cut - total_fill,
        intersection_polyline,
    }
}

fn filter_slivers(solids: Vec<SolidMesh>, filter: &SliverFilter) -> Vec<SolidMesh> {
    solids
        .into_iter()
        .filter(|s| {
            if s.volume < filter.min_volume_m3 {
                return false;
            }
            if avg_thickness(s) < filter.min_thickness_m {
                return false;
            }
            true
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_surface(z: f64, name: &str) -> TriSurface {
        TriSurface {
            name: name.to_string(),
            vertices: vec![
                Vec3::new(0.0, 0.0, z),
                Vec3::new(10.0, 0.0, z),
                Vec3::new(10.0, 10.0, z),
                Vec3::new(0.0, 10.0, z),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        }
    }

    #[test]
    fn pure_cut_between_flat_surfaces() {
        let upper = flat_surface(5.0, "pre_mining");
        let lower = flat_surface(0.0, "mined");

        let result = compute_cut_fill(&upper, &lower, SliverFilter::default());

        assert!(
            (result.total_cut_volume - 500.0).abs() < 30.0,
            "Cut volume {} not near expected 500",
            result.total_cut_volume
        );
        assert!(
            result.total_fill_volume < 1.0,
            "Should have no significant fill volume, got {}",
            result.total_fill_volume
        );
    }

    #[test]
    fn pure_fill_reversed() {
        let lower = flat_surface(0.0, "original");
        let upper = flat_surface(5.0, "filled");

        let result = compute_cut_fill(&lower, &upper, SliverFilter::default());

        assert!(
            result.total_cut_volume < 1.0,
            "Should have no cut volume, got {}",
            result.total_cut_volume
        );
        assert!(
            (result.total_fill_volume - 500.0).abs() < 30.0,
            "Fill volume {} not near expected 500",
            result.total_fill_volume
        );
    }

    #[test]
    fn crossing_surfaces_have_both_cut_and_fill() {
        let surface_a = TriSurface {
            name: "tilted_a".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 2.5),
                Vec3::new(10.0, 0.0, 7.5),
                Vec3::new(10.0, 10.0, 7.5),
                Vec3::new(0.0, 10.0, 2.5),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let surface_b = flat_surface(5.0, "flat_b");

        let result = compute_cut_fill(&surface_a, &surface_b, SliverFilter {
            min_volume_m3: 0.1,
            min_thickness_m: 0.01,
            min_triangles: 0,
        });

        assert!(
            result.total_cut_volume > 10.0,
            "Expected significant cut volume, got {}",
            result.total_cut_volume
        );
        assert!(
            result.total_fill_volume > 10.0,
            "Expected significant fill volume, got {}",
            result.total_fill_volume
        );

        let diff = (result.total_cut_volume - result.total_fill_volume).abs();
        let avg = (result.total_cut_volume + result.total_fill_volume) / 2.0;
        assert!(
            diff / avg < 0.15,
            "Cut ({}) and fill ({}) should be roughly equal",
            result.total_cut_volume,
            result.total_fill_volume
        );

        assert!(
            !result.intersection_polyline.is_empty(),
            "Should have intersection polyline"
        );
    }

    #[test]
    fn sliver_filter_removes_tiny_volumes() {
        let upper = flat_surface(0.01, "thin_upper");
        let lower = flat_surface(0.0, "lower");

        let strict_filter = SliverFilter {
            min_volume_m3: 0.5,
            min_thickness_m: 0.05,
            min_triangles: 0,
        };
        let result = compute_cut_fill(&upper, &lower, strict_filter);

        assert!(
            result.cut_solids.is_empty(),
            "Sliver filter should remove thin solid (avg thickness ~0.01m < 0.05m)"
        );
    }

    #[test]
    fn sliver_filter_keeps_substantial_volumes() {
        let upper = flat_surface(5.0, "upper");
        let lower = flat_surface(0.0, "lower");

        let filter = SliverFilter {
            min_volume_m3: 1.0,
            min_thickness_m: 0.1,
            min_triangles: 0,
        };
        let result = compute_cut_fill(&upper, &lower, filter);

        assert!(
            !result.cut_solids.is_empty(),
            "Filter should keep 500m³ solid"
        );
    }

    #[test]
    fn known_volume_two_simple_surfaces() {
        let upper = TriSurface {
            name: "design".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(20.0, 0.0, 10.0),
                Vec3::new(20.0, 20.0, 10.0),
                Vec3::new(0.0, 20.0, 10.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let lower = TriSurface {
            name: "actual".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(20.0, 0.0, 0.0),
                Vec3::new(20.0, 20.0, 0.0),
                Vec3::new(0.0, 20.0, 0.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let result = compute_cut_fill(&upper, &lower, SliverFilter {
            min_volume_m3: 0.01,
            min_thickness_m: 0.001,
            min_triangles: 0,
        });

        let expected = 4000.0;
        let pct_error = (result.total_cut_volume - expected).abs() / expected * 100.0;
        assert!(
            pct_error < 5.0,
            "Known volume test: expected ~4000 m³, got {} (error {:.1}%)",
            result.total_cut_volume,
            pct_error
        );
    }
}
