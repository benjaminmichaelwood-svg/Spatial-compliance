use crate::bvh::SurfaceBvh;
use crate::types::{SolidMesh, TriSurface, Vec3};

/// Build closed solid meshes between two surfaces using direct mesh-on-mesh computation.
///
/// Iterates triangles of the upper surface. For each triangle, interpolates the
/// lower surface Z at the three vertices using a BVH. If all three are valid and
/// upper > lower, a triangular prism (6 vertices, 8 triangles) is emitted.
///
/// Then repeats with the lower surface as reference and the upper as the lookup
/// target, catching any footprint regions that only the lower surface covers.
pub fn build_solid_between_surfaces(
    upper: &TriSurface,
    lower: &TriSurface,
    label: &str,
) -> Option<SolidMesh> {
    let lower_bvh = SurfaceBvh::build(lower);
    let upper_bvh = SurfaceBvh::build(upper);

    let mut vertices: Vec<Vec3> = Vec::new();
    let mut indices: Vec<[u32; 3]> = Vec::new();

    // Pass 1: iterate upper triangles, look up lower Z
    for ti in 0..upper.num_triangles() {
        let tri = upper.triangle(ti);
        let lz0 = lower_bvh.interpolate_z(tri.v0.x, tri.v0.y);
        let lz1 = lower_bvh.interpolate_z(tri.v1.x, tri.v1.y);
        let lz2 = lower_bvh.interpolate_z(tri.v2.x, tri.v2.y);

        if let (Some(l0), Some(l1), Some(l2)) = (lz0, lz1, lz2) {
            // At least one vertex must have upper > lower
            if tri.v0.z > l0 + 1e-9 || tri.v1.z > l1 + 1e-9 || tri.v2.z > l2 + 1e-9 {
                // Clamp: where upper <= lower, collapse to zero thickness
                let top = [tri.v0, tri.v1, tri.v2];
                let bot = [
                    l0.min(tri.v0.z),
                    l1.min(tri.v1.z),
                    l2.min(tri.v2.z),
                ];
                add_tri_prism(&mut vertices, &mut indices, top, bot);
            }
        }
    }

    // Pass 2: iterate lower triangles, add prisms for areas lower covers but upper doesn't
    for ti in 0..lower.num_triangles() {
        let tri = lower.triangle(ti);
        let cx = (tri.v0.x + tri.v1.x + tri.v2.x) / 3.0;
        let cy = (tri.v0.y + tri.v1.y + tri.v2.y) / 3.0;

        if upper_bvh.interpolate_z(cx, cy).is_some() {
            continue;
        }

        let uz0 = upper_bvh.interpolate_z(tri.v0.x, tri.v0.y);
        let uz1 = upper_bvh.interpolate_z(tri.v1.x, tri.v1.y);
        let uz2 = upper_bvh.interpolate_z(tri.v2.x, tri.v2.y);

        if let (Some(u0), Some(u1), Some(u2)) = (uz0, uz1, uz2) {
            if u0 > tri.v0.z + 1e-9 || u1 > tri.v1.z + 1e-9 || u2 > tri.v2.z + 1e-9 {
                let top = [
                    Vec3::new(tri.v0.x, tri.v0.y, u0.max(tri.v0.z)),
                    Vec3::new(tri.v1.x, tri.v1.y, u1.max(tri.v1.z)),
                    Vec3::new(tri.v2.x, tri.v2.y, u2.max(tri.v2.z)),
                ];
                let bot = [tri.v0.z, tri.v1.z, tri.v2.z];
                add_tri_prism(&mut vertices, &mut indices, top, bot);
            }
        }
    }

    if vertices.is_empty() {
        return None;
    }

    let volume = compute_signed_volume(&vertices, &indices).abs();
    let surface_area = compute_surface_area(&vertices, &indices);

    Some(SolidMesh {
        label: label.to_string(),
        vertices,
        indices,
        volume,
        surface_area,
    })
}

/// Add a triangular prism between a top triangle and a bottom triangle.
/// top_z and bot_z are the Z values at the three XY positions.
/// The top triangle vertices define the XY positions.
fn add_tri_prism(
    vertices: &mut Vec<Vec3>,
    indices: &mut Vec<[u32; 3]>,
    top: [Vec3; 3],
    bot_z: [f64; 3],
) {
    let base = vertices.len() as u32;

    // Top vertices (0, 1, 2)
    vertices.push(top[0]);
    vertices.push(top[1]);
    vertices.push(top[2]);
    // Bottom vertices (3, 4, 5)
    vertices.push(Vec3::new(top[0].x, top[0].y, bot_z[0]));
    vertices.push(Vec3::new(top[1].x, top[1].y, bot_z[1]));
    vertices.push(Vec3::new(top[2].x, top[2].y, bot_z[2]));

    // Top face (outward normal up, CCW from above)
    indices.push([base, base + 1, base + 2]);

    // Bottom face (outward normal down, CW from above)
    indices.push([base + 3, base + 5, base + 4]);

    // Three side faces (two triangles each, outward normals)
    let sides: [(u32, u32); 3] = [(0, 1), (1, 2), (2, 0)];
    for &(a, b) in &sides {
        let ta = base + a;
        let tb = base + b;
        let ba = base + 3 + a;
        let bb = base + 3 + b;
        indices.push([ta, bb, tb]);
        indices.push([ta, ba, bb]);
    }
}

/// Signed volume of a closed triangulated mesh using the divergence theorem.
pub fn compute_signed_volume(vertices: &[Vec3], indices: &[[u32; 3]]) -> f64 {
    let mut vol = 0.0;
    for tri in indices {
        let v0 = vertices[tri[0] as usize];
        let v1 = vertices[tri[1] as usize];
        let v2 = vertices[tri[2] as usize];
        vol += v0.dot(v1.cross(v2));
    }
    vol / 6.0
}

/// Total surface area of a triangle mesh.
pub fn compute_surface_area(vertices: &[Vec3], indices: &[[u32; 3]]) -> f64 {
    let mut area = 0.0;
    for tri in indices {
        let v0 = vertices[tri[0] as usize];
        let v1 = vertices[tri[1] as usize];
        let v2 = vertices[tri[2] as usize];
        area += (v1 - v0).cross(v2 - v0).length() * 0.5;
    }
    area
}

/// Compute the maximum thickness (Z range) of a solid mesh.
pub fn max_thickness(solid: &SolidMesh) -> f64 {
    if solid.vertices.is_empty() {
        return 0.0;
    }
    let mut min_z = f64::INFINITY;
    let mut max_z = f64::NEG_INFINITY;
    for v in &solid.vertices {
        min_z = min_z.min(v.z);
        max_z = max_z.max(v.z);
    }
    max_z - min_z
}

/// Compute average thickness = volume / footprint_area.
pub fn avg_thickness(solid: &SolidMesh) -> f64 {
    if solid.volume < 1e-12 {
        return 0.0;
    }

    let mut footprint = 0.0;
    for tri in &solid.indices {
        let v0 = solid.vertices[tri[0] as usize];
        let v1 = solid.vertices[tri[1] as usize];
        let v2 = solid.vertices[tri[2] as usize];
        let normal = (v1 - v0).cross(v2 - v0);
        if normal.z > 0.0 {
            let area_2d = ((v1.x - v0.x) * (v2.y - v0.y) - (v1.y - v0.y) * (v2.x - v0.x)).abs()
                * 0.5;
            footprint += area_2d;
        }
    }

    if footprint < 1e-12 {
        return max_thickness(solid);
    }

    solid.volume / footprint
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_flat_surface(z: f64, name: &str) -> TriSurface {
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
    fn flat_surfaces_volume() {
        let upper = make_flat_surface(5.0, "upper");
        let lower = make_flat_surface(0.0, "lower");

        let solid = build_solid_between_surfaces(&upper, &lower, "test").unwrap();

        let expected = 500.0;
        let tolerance = expected * 0.05;
        assert!(
            (solid.volume - expected).abs() < tolerance,
            "Volume {} not within 5% of expected {}",
            solid.volume,
            expected
        );
    }

    #[test]
    fn tilted_upper_volume() {
        let lower = make_flat_surface(0.0, "lower");

        let upper = TriSurface {
            name: "tilted".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 2.0),
                Vec3::new(10.0, 0.0, 8.0),
                Vec3::new(10.0, 10.0, 8.0),
                Vec3::new(0.0, 10.0, 2.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let solid = build_solid_between_surfaces(&upper, &lower, "test").unwrap();

        let expected = 500.0;
        let tolerance = expected * 0.05;
        assert!(
            (solid.volume - expected).abs() < tolerance,
            "Volume {} not within 5% of expected {}",
            solid.volume,
            expected
        );
    }

    #[test]
    fn no_overlap_returns_none() {
        let s1 = TriSurface {
            name: "a".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 5.0),
                Vec3::new(1.0, 0.0, 5.0),
                Vec3::new(0.0, 1.0, 5.0),
            ],
            indices: vec![[0, 1, 2]],
        };
        let s2 = TriSurface {
            name: "b".into(),
            vertices: vec![
                Vec3::new(100.0, 100.0, 0.0),
                Vec3::new(101.0, 100.0, 0.0),
                Vec3::new(100.0, 101.0, 0.0),
            ],
            indices: vec![[0, 1, 2]],
        };

        assert!(build_solid_between_surfaces(&s1, &s2, "none").is_none());
    }

    #[test]
    fn signed_volume_unit_cube() {
        let vertices = vec![
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(1.0, 1.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(1.0, 0.0, 1.0),
            Vec3::new(1.0, 1.0, 1.0),
            Vec3::new(0.0, 1.0, 1.0),
        ];
        let indices: Vec<[u32; 3]> = vec![
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [2, 3, 7],
            [2, 7, 6],
            [0, 4, 7],
            [0, 7, 3],
            [1, 2, 6],
            [1, 6, 5],
        ];

        let vol = compute_signed_volume(&vertices, &indices);
        assert!(
            (vol - 1.0).abs() < 1e-10,
            "Unit cube volume should be 1.0, got {}",
            vol
        );
    }
}
