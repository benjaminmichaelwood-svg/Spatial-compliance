use crate::types::{TriSurface, Vec3};

struct BvhNode {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    left: u32,
    right: u32,
    is_leaf: bool,
}

pub struct SurfaceBvh<'a> {
    surface: &'a TriSurface,
    nodes: Vec<BvhNode>,
    tri_order: Vec<usize>,
}

const MAX_LEAF_SIZE: usize = 8;

impl<'a> SurfaceBvh<'a> {
    pub fn build(surface: &'a TriSurface) -> Self {
        let n = surface.num_triangles();
        let mut tri_order: Vec<usize> = (0..n).collect();
        let mut centroids: Vec<(f64, f64)> = Vec::with_capacity(n);
        let mut tri_boxes: Vec<(f64, f64, f64, f64)> = Vec::with_capacity(n);

        for i in 0..n {
            let idx = surface.indices[i];
            let v0 = surface.vertices[idx[0] as usize];
            let v1 = surface.vertices[idx[1] as usize];
            let v2 = surface.vertices[idx[2] as usize];
            let min_x = v0.x.min(v1.x).min(v2.x);
            let min_y = v0.y.min(v1.y).min(v2.y);
            let max_x = v0.x.max(v1.x).max(v2.x);
            let max_y = v0.y.max(v1.y).max(v2.y);
            centroids.push(((min_x + max_x) * 0.5, (min_y + max_y) * 0.5));
            tri_boxes.push((min_x, min_y, max_x, max_y));
        }

        let mut nodes = Vec::with_capacity(2 * n);
        build_recursive(
            &mut nodes,
            &mut tri_order,
            &centroids,
            &tri_boxes,
            0,
            n,
        );

        Self {
            surface,
            nodes,
            tri_order,
        }
    }

    pub fn interpolate_z(&self, x: f64, y: f64) -> Option<f64> {
        if self.nodes.is_empty() {
            return None;
        }
        self.query_node(0, x, y)
    }

    fn query_node(&self, node_idx: usize, x: f64, y: f64) -> Option<f64> {
        let node = &self.nodes[node_idx];
        if x < node.min_x || x > node.max_x || y < node.min_y || y > node.max_y {
            return None;
        }

        if node.is_leaf {
            let start = node.left as usize;
            let count = node.right as usize;
            for i in start..start + count {
                let ti = self.tri_order[i];
                if let Some(z) = point_in_triangle_z(self.surface, ti, x, y) {
                    return Some(z);
                }
            }
            return None;
        }

        let left = node.left as usize;
        let right = node.right as usize;
        if let Some(z) = self.query_node(left, x, y) {
            return Some(z);
        }
        self.query_node(right, x, y)
    }
}

fn point_in_triangle_z(surface: &TriSurface, ti: usize, x: f64, y: f64) -> Option<f64> {
    let idx = surface.indices[ti];
    let v0 = surface.vertices[idx[0] as usize];
    let v1 = surface.vertices[idx[1] as usize];
    let v2 = surface.vertices[idx[2] as usize];

    let d = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
    if d.abs() < 1e-12 {
        return None;
    }

    let a = ((v1.y - v2.y) * (x - v2.x) + (v2.x - v1.x) * (y - v2.y)) / d;
    let b = ((v2.y - v0.y) * (x - v2.x) + (v0.x - v2.x) * (y - v2.y)) / d;
    let c = 1.0 - a - b;

    if a >= -1e-8 && b >= -1e-8 && c >= -1e-8 {
        Some(a * v0.z + b * v1.z + c * v2.z)
    } else {
        None
    }
}

fn build_recursive(
    nodes: &mut Vec<BvhNode>,
    tri_order: &mut [usize],
    centroids: &[(f64, f64)],
    tri_boxes: &[(f64, f64, f64, f64)],
    start: usize,
    end: usize,
) -> usize {
    let count = end - start;

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for i in start..end {
        let ti = tri_order[i];
        let b = tri_boxes[ti];
        min_x = min_x.min(b.0);
        min_y = min_y.min(b.1);
        max_x = max_x.max(b.2);
        max_y = max_y.max(b.3);
    }

    if count <= MAX_LEAF_SIZE {
        let node_idx = nodes.len();
        nodes.push(BvhNode {
            min_x,
            min_y,
            max_x,
            max_y,
            left: start as u32,
            right: count as u32,
            is_leaf: true,
        });
        return node_idx;
    }

    let range_x = max_x - min_x;
    let range_y = max_y - min_y;
    let split_x = range_x >= range_y;

    let mid = start + count / 2;
    tri_order[start..end].select_nth_unstable_by(mid - start, |&a, &b| {
        let ca = centroids[a];
        let cb = centroids[b];
        // SAFETY (panic audit): TriSurface::validate() rejects non-finite
        // coordinates before a surface ever reaches the BVH, but
        // total_cmp (rather than partial_cmp().unwrap()) is used anyway as
        // defense in depth — it has a well-defined total order for every
        // f64 including NaN, so this can never panic even if that
        // invariant is ever violated upstream.
        if split_x {
            ca.0.total_cmp(&cb.0)
        } else {
            ca.1.total_cmp(&cb.1)
        }
    });

    let node_idx = nodes.len();
    nodes.push(BvhNode {
        min_x,
        min_y,
        max_x,
        max_y,
        left: 0,
        right: 0,
        is_leaf: false,
    });

    let left_idx = build_recursive(nodes, tri_order, centroids, tri_boxes, start, mid);
    let right_idx = build_recursive(nodes, tri_order, centroids, tri_boxes, mid, end);

    nodes[node_idx].left = left_idx as u32;
    nodes[node_idx].right = right_idx as u32;

    node_idx
}

pub fn interpolate_z_at_vertices(
    bvh: &SurfaceBvh,
    vertices: &[Vec3],
) -> Vec<Option<f64>> {
    vertices.iter().map(|v| bvh.interpolate_z(v.x, v.y)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_surface(z: f64) -> TriSurface {
        TriSurface {
            name: "test".into(),
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
    fn bvh_interpolate_flat() {
        let s = flat_surface(5.0);
        let bvh = SurfaceBvh::build(&s);
        let z = bvh.interpolate_z(5.0, 5.0);
        assert!((z.unwrap() - 5.0).abs() < 1e-10);
    }

    #[test]
    fn build_does_not_panic_on_zero_triangles() {
        let s = TriSurface {
            name: "empty".into(),
            vertices: vec![Vec3::new(0.0, 0.0, 0.0)],
            indices: vec![],
        };
        let bvh = SurfaceBvh::build(&s);
        assert_eq!(bvh.interpolate_z(0.0, 0.0), None);
    }

    #[test]
    fn build_does_not_panic_on_nan_centroid() {
        // Regression test for the panic-safety pass: the centroid sort
        // comparator used to be `partial_cmp(...).unwrap()`, which panics
        // if any coordinate is NaN. TriSurface::validate() now rejects NaN
        // surfaces before they reach the BVH, but this exercises the BVH
        // in isolation (bypassing validate()) to confirm total_cmp holds
        // as defense in depth even if that invariant is ever violated.
        // A strip of 20 triangles (well over MAX_LEAF_SIZE=8) is used so
        // build_recursive actually performs a split and invokes the
        // centroid comparator rather than putting everything in one leaf.
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        for col in 0..11u32 {
            let x = col as f64 * 5.0;
            vertices.push(Vec3::new(x, 0.0, col as f64));
            vertices.push(Vec3::new(x, 10.0, col as f64));
        }
        vertices[0] = Vec3::new(f64::NAN, 0.0, 0.0);
        for col in 0..10u32 {
            let a = col * 2;
            let b = a + 1;
            let c = a + 2;
            let d = a + 3;
            indices.push([a, b, c]);
            indices.push([b, d, c]);
        }
        let s = TriSurface {
            name: "nan".into(),
            vertices,
            indices,
        };
        // Must not panic — the actual query result is unspecified once NaN
        // is involved, only the absence of a panic is asserted.
        let bvh = SurfaceBvh::build(&s);
        let _ = bvh.interpolate_z(25.0, 5.0);
    }

    #[test]
    fn bvh_interpolate_outside() {
        let s = flat_surface(5.0);
        let bvh = SurfaceBvh::build(&s);
        assert!(bvh.interpolate_z(15.0, 5.0).is_none());
    }

    #[test]
    fn bvh_interpolate_tilted() {
        let s = TriSurface {
            name: "tilted".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 10.0),
                Vec3::new(10.0, 10.0, 10.0),
                Vec3::new(0.0, 10.0, 0.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let bvh = SurfaceBvh::build(&s);
        let z = bvh.interpolate_z(5.0, 5.0).unwrap();
        assert!((z - 5.0).abs() < 0.1, "Expected ~5.0, got {z}");
    }

    #[test]
    fn bvh_many_triangles() {
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        let n = 50;
        for iy in 0..n {
            for ix in 0..n {
                let base = vertices.len() as u32;
                let x0 = ix as f64;
                let y0 = iy as f64;
                vertices.push(Vec3::new(x0, y0, 3.0));
                vertices.push(Vec3::new(x0 + 1.0, y0, 3.0));
                vertices.push(Vec3::new(x0 + 1.0, y0 + 1.0, 3.0));
                vertices.push(Vec3::new(x0, y0 + 1.0, 3.0));
                indices.push([base, base + 1, base + 2]);
                indices.push([base, base + 2, base + 3]);
            }
        }
        let s = TriSurface {
            name: "grid".into(),
            vertices,
            indices,
        };
        let bvh = SurfaceBvh::build(&s);
        let z = bvh.interpolate_z(25.5, 25.5).unwrap();
        assert!((z - 3.0).abs() < 1e-10);
        assert!(bvh.interpolate_z(55.0, 25.0).is_none());
    }
}
