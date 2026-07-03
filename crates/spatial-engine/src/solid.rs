use crate::types::{SolidMesh, TriSurface, Vec3};

/// Interpolate Z on a triangle surface at point (x, y).
/// Uses barycentric coordinates for each triangle.
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

/// Build closed solid meshes between two surfaces using a grid sampling approach.
///
/// For each grid cell where both surfaces are defined, we create a hexahedral
/// prism (top quad from upper surface, bottom quad from lower surface, four side
/// quads) triangulated into the solid mesh. The result is a watertight mesh whose
/// signed volume equals the material between the surfaces.
pub fn build_solid_between_surfaces(
    upper: &TriSurface,
    lower: &TriSurface,
    label: &str,
    resolution: usize,
) -> Option<SolidMesh> {
    let (u_min, u_max) = upper.bounding_box();
    let (l_min, l_max) = lower.bounding_box();

    let min_x = u_min.x.max(l_min.x);
    let max_x = u_max.x.min(l_max.x);
    let min_y = u_min.y.max(l_min.y);
    let max_y = u_max.y.min(l_max.y);

    if min_x >= max_x || min_y >= max_y {
        return None;
    }

    let range_x = max_x - min_x;
    let range_y = max_y - min_y;
    let cell_size = range_x.max(range_y) / resolution as f64;
    let nx = ((range_x / cell_size).ceil() as usize).max(1);
    let ny = ((range_y / cell_size).ceil() as usize).max(1);

    // Sample Z values on a grid for both surfaces
    let grid_w = nx + 1;
    let grid_h = ny + 1;
    let mut upper_z = vec![None; grid_w * grid_h];
    let mut lower_z = vec![None; grid_w * grid_h];

    for iy in 0..grid_h {
        for ix in 0..grid_w {
            let x = min_x + ix as f64 * cell_size;
            let y = min_y + iy as f64 * cell_size;
            let gi = iy * grid_w + ix;
            upper_z[gi] = interpolate_z(upper, x, y);
            lower_z[gi] = interpolate_z(lower, x, y);
        }
    }

    let mut vertices: Vec<Vec3> = Vec::new();
    let mut indices: Vec<[u32; 3]> = Vec::new();

    // For each grid cell, if all four corners have valid Z on both surfaces
    // and upper > lower at all corners, emit a closed prism.
    for iy in 0..ny {
        for ix in 0..nx {
            let corners = [
                iy * grid_w + ix,
                iy * grid_w + ix + 1,
                (iy + 1) * grid_w + ix + 1,
                (iy + 1) * grid_w + ix,
            ];

            let mut valid = true;
            let mut top = [Vec3::new(0.0, 0.0, 0.0); 4];
            let mut bot = [Vec3::new(0.0, 0.0, 0.0); 4];

            for (ci, &gi) in corners.iter().enumerate() {
                let ux = min_x + (gi % grid_w) as f64 * cell_size;
                let uy = min_y + (gi / grid_w) as f64 * cell_size;

                match (upper_z[gi], lower_z[gi]) {
                    (Some(uz), Some(lz)) if uz > lz + 1e-9 => {
                        top[ci] = Vec3::new(ux, uy, uz);
                        bot[ci] = Vec3::new(ux, uy, lz);
                    }
                    _ => {
                        valid = false;
                        break;
                    }
                }
            }

            if !valid {
                continue;
            }

            let base = vertices.len() as u32;

            // Vertices: 0-3 = top quad, 4-7 = bottom quad
            for v in &top {
                vertices.push(*v);
            }
            for v in &bot {
                vertices.push(*v);
            }

            // Top face (CCW when viewed from above = outward normal up)
            indices.push([base, base + 1, base + 2]);
            indices.push([base, base + 2, base + 3]);

            // Bottom face (CW when viewed from above = outward normal down)
            indices.push([base + 4, base + 6, base + 5]);
            indices.push([base + 4, base + 7, base + 6]);

            // Side faces — winding reversed so outward normals point away from the prism
            let sides: [(usize, usize); 4] = [(0, 1), (1, 2), (2, 3), (3, 0)];
            for &(a, b) in &sides {
                let ta = base + a as u32;
                let tb = base + b as u32;
                let ba = base + 4 + a as u32;
                let bb = base + 4 + b as u32;
                indices.push([ta, bb, tb]);
                indices.push([ta, ba, bb]);
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

/// Signed volume of a closed triangulated mesh using the divergence theorem.
/// V = (1/6) * Σ (v0 · (v1 × v2)) for each triangle.
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
/// Footprint area estimated from top-face triangles (those with upward-facing normals).
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
            // Project onto XY plane for footprint area
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

        let solid = build_solid_between_surfaces(&upper, &lower, "test", 10).unwrap();

        // 10x10 footprint, 5m height = 500 m³
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
        // Lower: flat at z=0
        let lower = make_flat_surface(0.0, "lower");

        // Upper: tilted plane z = 2 + 0.6*x (goes from z=2 at x=0 to z=8 at x=10)
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

        let solid = build_solid_between_surfaces(&upper, &lower, "test", 50).unwrap();

        // Average height = (2+8)/2 = 5, area = 100, volume = 500
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

        assert!(build_solid_between_surfaces(&s1, &s2, "none", 10).is_none());
    }

    #[test]
    fn signed_volume_unit_cube() {
        // Manually defined unit cube vertices and triangles (outward normals)
        let vertices = vec![
            Vec3::new(0.0, 0.0, 0.0), // 0
            Vec3::new(1.0, 0.0, 0.0), // 1
            Vec3::new(1.0, 1.0, 0.0), // 2
            Vec3::new(0.0, 1.0, 0.0), // 3
            Vec3::new(0.0, 0.0, 1.0), // 4
            Vec3::new(1.0, 0.0, 1.0), // 5
            Vec3::new(1.0, 1.0, 1.0), // 6
            Vec3::new(0.0, 1.0, 1.0), // 7
        ];
        let indices: Vec<[u32; 3]> = vec![
            // Bottom (z=0, normal -z)
            [0, 2, 1],
            [0, 3, 2],
            // Top (z=1, normal +z)
            [4, 5, 6],
            [4, 6, 7],
            // Front (y=0, normal -y)
            [0, 1, 5],
            [0, 5, 4],
            // Back (y=1, normal +y)
            [2, 3, 7],
            [2, 7, 6],
            // Left (x=0, normal -x)
            [0, 4, 7],
            [0, 7, 3],
            // Right (x=1, normal +x)
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
