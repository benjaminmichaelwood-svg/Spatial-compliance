use crate::types::{Triangle, TriSurface, Vec3};

/// A segment of the intersection polyline between two surfaces.
#[derive(Debug, Clone)]
pub struct IntersectionSegment {
    pub start: Vec3,
    pub end: Vec3,
}

/// Compute the intersection line between triangle plane and the other triangle.
/// Returns the segment where they overlap, if any.
fn triangle_triangle_intersection(t1: &Triangle, t2: &Triangle) -> Option<IntersectionSegment> {
    let n1 = (t1.v1 - t1.v0).cross(t1.v2 - t1.v0);
    let n2 = (t2.v1 - t2.v0).cross(t2.v2 - t2.v0);

    if n1.length() < 1e-12 || n2.length() < 1e-12 {
        return None;
    }

    let d1 = [
        n2.dot(t1.v0 - t2.v0),
        n2.dot(t1.v1 - t2.v0),
        n2.dot(t1.v2 - t2.v0),
    ];
    let d2 = [
        n1.dot(t2.v0 - t1.v0),
        n1.dot(t2.v1 - t1.v0),
        n1.dot(t2.v2 - t1.v0),
    ];

    if (d1[0] > 0.0 && d1[1] > 0.0 && d1[2] > 0.0)
        || (d1[0] < 0.0 && d1[1] < 0.0 && d1[2] < 0.0)
    {
        return None;
    }
    if (d2[0] > 0.0 && d2[1] > 0.0 && d2[2] > 0.0)
        || (d2[0] < 0.0 && d2[1] < 0.0 && d2[2] < 0.0)
    {
        return None;
    }

    let dir = n1.cross(n2);
    if dir.length() < 1e-12 {
        return None;
    }

    let verts1 = [t1.v0, t1.v1, t1.v2];
    let verts2 = [t2.v0, t2.v1, t2.v2];

    let seg1 = edge_plane_intersections(&verts1, &d1)?;
    let seg2 = edge_plane_intersections(&verts2, &d2)?;

    let axis = if dir.x.abs() >= dir.y.abs() && dir.x.abs() >= dir.z.abs() {
        0
    } else if dir.y.abs() >= dir.z.abs() {
        1
    } else {
        2
    };

    let project = |v: &Vec3| match axis {
        0 => v.x,
        1 => v.y,
        _ => v.z,
    };

    let (mut a0, mut a1) = (project(&seg1.0), project(&seg1.1));
    let (mut b0, mut b1) = (project(&seg2.0), project(&seg2.1));
    let (mut p0, mut p1) = (seg1.0, seg1.1);
    let (mut q0, mut q1) = (seg2.0, seg2.1);

    if a0 > a1 {
        std::mem::swap(&mut a0, &mut a1);
        std::mem::swap(&mut p0, &mut p1);
    }
    if b0 > b1 {
        std::mem::swap(&mut b0, &mut b1);
        std::mem::swap(&mut q0, &mut q1);
    }

    let overlap_start = a0.max(b0);
    let overlap_end = a1.min(b1);

    if overlap_start >= overlap_end - 1e-12 {
        return None;
    }

    let start = if a0 >= b0 {
        lerp_on_interval(p0, p1, a0, a1, overlap_start)
    } else {
        lerp_on_interval(q0, q1, b0, b1, overlap_start)
    };

    let end = if a1 <= b1 {
        lerp_on_interval(p0, p1, a0, a1, overlap_end)
    } else {
        lerp_on_interval(q0, q1, b0, b1, overlap_end)
    };

    if start.distance(end) < 1e-12 {
        return None;
    }

    Some(IntersectionSegment { start, end })
}

fn lerp_on_interval(v0: Vec3, v1: Vec3, t0: f64, t1: f64, t: f64) -> Vec3 {
    if (t1 - t0).abs() < 1e-15 {
        return v0;
    }
    let frac = (t - t0) / (t1 - t0);
    v0.lerp(v1, frac)
}

/// Find the two intersection points where triangle edges cross a plane (defined by signed distances).
fn edge_plane_intersections(verts: &[Vec3; 3], dists: &[f64; 3]) -> Option<(Vec3, Vec3)> {
    let mut points = Vec::with_capacity(2);
    let edges = [(0, 1), (1, 2), (2, 0)];

    for &(i, j) in &edges {
        let di = dists[i];
        let dj = dists[j];

        if di.abs() < 1e-12 {
            let p = verts[i];
            if points.is_empty() || points.last().map_or(true, |last: &Vec3| last.distance(p) > 1e-10) {
                points.push(p);
            }
            continue;
        }

        if (di > 0.0) != (dj > 0.0) {
            let t = di / (di - dj);
            let p = verts[i].lerp(verts[j], t);
            if points.is_empty() || points.last().map_or(true, |last: &Vec3| last.distance(p) > 1e-10) {
                points.push(p);
            }
        }
    }

    if points.len() >= 2 {
        Some((points[0], points[1]))
    } else {
        None
    }
}

/// Compute all intersection segments between two triangle surfaces.
pub fn compute_intersection_polyline(s1: &TriSurface, s2: &TriSurface) -> Vec<IntersectionSegment> {
    let (bb1_min, bb1_max) = s1.bounding_box();
    let (bb2_min, bb2_max) = s2.bounding_box();

    if bb1_max.x < bb2_min.x
        || bb1_min.x > bb2_max.x
        || bb1_max.y < bb2_min.y
        || bb1_min.y > bb2_max.y
        || bb1_max.z < bb2_min.z
        || bb1_min.z > bb2_max.z
    {
        return vec![];
    }

    let mut segments = Vec::new();

    for i in 0..s1.num_triangles() {
        let t1 = s1.triangle(i);
        let t1_min = Vec3::new(
            t1.v0.x.min(t1.v1.x).min(t1.v2.x),
            t1.v0.y.min(t1.v1.y).min(t1.v2.y),
            t1.v0.z.min(t1.v1.z).min(t1.v2.z),
        );
        let t1_max = Vec3::new(
            t1.v0.x.max(t1.v1.x).max(t1.v2.x),
            t1.v0.y.max(t1.v1.y).max(t1.v2.y),
            t1.v0.z.max(t1.v1.z).max(t1.v2.z),
        );

        for j in 0..s2.num_triangles() {
            let t2 = s2.triangle(j);
            let t2_min = Vec3::new(
                t2.v0.x.min(t2.v1.x).min(t2.v2.x),
                t2.v0.y.min(t2.v1.y).min(t2.v2.y),
                t2.v0.z.min(t2.v1.z).min(t2.v2.z),
            );
            let t2_max = Vec3::new(
                t2.v0.x.max(t2.v1.x).max(t2.v2.x),
                t2.v0.y.max(t2.v1.y).max(t2.v2.y),
                t2.v0.z.max(t2.v1.z).max(t2.v2.z),
            );

            if t1_max.x < t2_min.x
                || t1_min.x > t2_max.x
                || t1_max.y < t2_min.y
                || t1_min.y > t2_max.y
                || t1_max.z < t2_min.z
                || t1_min.z > t2_max.z
            {
                continue;
            }

            if let Some(seg) = triangle_triangle_intersection(&t1, &t2) {
                segments.push(seg);
            }
        }
    }

    segments
}

/// Chain intersection segments into ordered polylines.
pub fn chain_segments(segments: &[IntersectionSegment], tolerance: f64) -> Vec<Vec<Vec3>> {
    if segments.is_empty() {
        return vec![];
    }

    let mut used = vec![false; segments.len()];
    let mut polylines = Vec::new();

    loop {
        let start_idx = match used.iter().position(|&u| !u) {
            Some(i) => i,
            None => break,
        };

        used[start_idx] = true;
        let mut chain = vec![segments[start_idx].start, segments[start_idx].end];

        let mut changed = true;
        while changed {
            changed = false;
            for (i, seg) in segments.iter().enumerate() {
                if used[i] {
                    continue;
                }

                let front = chain.first().unwrap();
                let back = chain.last().unwrap();

                if seg.end.distance(*back) < tolerance {
                    chain.push(seg.start);
                    // reversed — push start as the extension
                    // Actually we want to extend: back -> seg.start if seg.end~=back
                    // No: if seg.end is near back, the chain goes ...back, seg.start? No.
                    // seg goes start->end. If end~=back, chain continues from start.
                    // We want: chain..., seg.start (wrong direction).
                    // Let me fix: if seg.start~=back, append seg.end.
                    // if seg.end~=back, append seg.start.
                    chain.pop(); // undo
                    chain.push(seg.start);
                    used[i] = true;
                    changed = true;
                } else if seg.start.distance(*back) < tolerance {
                    chain.push(seg.end);
                    used[i] = true;
                    changed = true;
                } else if seg.start.distance(*front) < tolerance {
                    chain.insert(0, seg.end);
                    used[i] = true;
                    changed = true;
                } else if seg.end.distance(*front) < tolerance {
                    chain.insert(0, seg.start);
                    used[i] = true;
                    changed = true;
                }
            }
        }

        polylines.push(chain);
    }

    polylines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intersecting_triangles() {
        // Horizontal triangle at z=0
        let t1 = Triangle::new(
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(10.0, 0.0, 0.0),
            Vec3::new(5.0, 10.0, 0.0),
        );
        // Vertical-ish triangle crossing z=0
        let t2 = Triangle::new(
            Vec3::new(2.0, 2.0, -5.0),
            Vec3::new(8.0, 2.0, -5.0),
            Vec3::new(5.0, 2.0, 5.0),
        );

        let seg = triangle_triangle_intersection(&t1, &t2);
        assert!(seg.is_some(), "Expected intersection between crossing triangles");
    }

    #[test]
    fn non_intersecting_triangles() {
        let t1 = Triangle::new(
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
        );
        let t2 = Triangle::new(
            Vec3::new(0.0, 0.0, 10.0),
            Vec3::new(1.0, 0.0, 10.0),
            Vec3::new(0.0, 1.0, 10.0),
        );

        let seg = triangle_triangle_intersection(&t1, &t2);
        assert!(seg.is_none());
    }

    #[test]
    fn surface_intersection_polyline() {
        // Upper surface: flat at z=5
        let upper = TriSurface {
            name: "upper".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 5.0),
                Vec3::new(10.0, 0.0, 5.0),
                Vec3::new(10.0, 10.0, 5.0),
                Vec3::new(0.0, 10.0, 5.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        // Tilted surface crossing z=5 at y=5
        let tilted = TriSurface {
            name: "tilted".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(10.0, 10.0, 10.0),
                Vec3::new(0.0, 10.0, 10.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let segments = compute_intersection_polyline(&upper, &tilted);
        assert!(!segments.is_empty(), "Expected intersection segments");

        // All intersection points should be near z=5
        for seg in &segments {
            assert!(
                (seg.start.z - 5.0).abs() < 0.5,
                "Intersection start z={} expected near 5.0",
                seg.start.z
            );
            assert!(
                (seg.end.z - 5.0).abs() < 0.5,
                "Intersection end z={} expected near 5.0",
                seg.end.z
            );
        }
    }
}
