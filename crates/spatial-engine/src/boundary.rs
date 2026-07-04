use std::collections::HashMap;

use crate::types::{BoundaryRegion, TriSurface};

pub fn point_in_polygon(x: f64, y: f64, polygon: &[[f64; 2]]) -> bool {
    let n = polygon.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (polygon[i][0], polygon[i][1]);
        let (xj, yj) = (polygon[j][0], polygon[j][1]);
        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

pub fn assign_cell_to_boundary(
    cx: f64,
    cy: f64,
    boundaries: &[BoundaryRegion],
) -> Option<usize> {
    for (i, b) in boundaries.iter().enumerate() {
        if point_in_polygon(cx, cy, &b.polygon) {
            return Some(i);
        }
    }
    None
}

fn polygon_area(polygon: &[[f64; 2]]) -> f64 {
    let n = polygon.len();
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += polygon[i][0] * polygon[j][1];
        area -= polygon[j][0] * polygon[i][1];
    }
    area.abs() / 2.0
}

fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

pub fn extract_surface_outline(surface: &TriSurface) -> Option<BoundaryRegion> {
    let mut edge_count: HashMap<(u32, u32), u32> = HashMap::new();
    for idx in &surface.indices {
        let edges = [
            edge_key(idx[0], idx[1]),
            edge_key(idx[1], idx[2]),
            edge_key(idx[2], idx[0]),
        ];
        for e in &edges {
            *edge_count.entry(*e).or_insert(0) += 1;
        }
    }

    let boundary_edges: Vec<(u32, u32)> = edge_count
        .into_iter()
        .filter(|&(_, count)| count == 1)
        .map(|(edge, _)| edge)
        .collect();

    if boundary_edges.is_empty() {
        return None;
    }

    let mut adj: HashMap<u32, Vec<u32>> = HashMap::new();
    for &(a, b) in &boundary_edges {
        adj.entry(a).or_default().push(b);
        adj.entry(b).or_default().push(a);
    }

    let mut loops: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut visited_edges: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();

    for &(start_a, start_b) in &boundary_edges {
        let start_key = edge_key(start_a, start_b);
        if visited_edges.contains(&start_key) {
            continue;
        }

        let mut chain = vec![start_a];
        let mut prev = start_a;
        let mut cur = start_b;
        visited_edges.insert(start_key);

        loop {
            chain.push(cur);
            if cur == start_a {
                break;
            }

            let neighbors = match adj.get(&cur) {
                Some(n) => n,
                None => break,
            };

            let next = neighbors.iter().find(|&&n| {
                n != prev && !visited_edges.contains(&edge_key(cur, n))
            });

            match next {
                Some(&n) => {
                    visited_edges.insert(edge_key(cur, n));
                    prev = cur;
                    cur = n;
                }
                None => break,
            }
        }

        if chain.len() >= 4 && chain.first() == chain.last() {
            chain.pop();
            let polygon: Vec<[f64; 2]> = chain
                .iter()
                .map(|&vi| {
                    let v = &surface.vertices[vi as usize];
                    [v.x, v.y]
                })
                .collect();
            loops.push(polygon);
        }
    }

    if loops.is_empty() {
        return None;
    }

    let largest = loops
        .into_iter()
        .max_by(|a, b| polygon_area(a).partial_cmp(&polygon_area(b)).unwrap())
        .unwrap();

    Some(BoundaryRegion {
        name: surface.name.clone(),
        polygon: largest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Vec3;

    #[test]
    fn point_inside_square() {
        let poly = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        assert!(point_in_polygon(5.0, 5.0, &poly));
        assert!(!point_in_polygon(15.0, 5.0, &poly));
        assert!(!point_in_polygon(-1.0, 5.0, &poly));
    }

    #[test]
    fn point_inside_triangle() {
        let poly = vec![[0.0, 0.0], [10.0, 0.0], [5.0, 10.0]];
        assert!(point_in_polygon(5.0, 3.0, &poly));
        assert!(!point_in_polygon(0.0, 10.0, &poly));
    }

    #[test]
    fn assign_cell_first_match() {
        let boundaries = vec![
            BoundaryRegion {
                name: "A".into(),
                polygon: vec![[0.0, 0.0], [5.0, 0.0], [5.0, 5.0], [0.0, 5.0]],
            },
            BoundaryRegion {
                name: "B".into(),
                polygon: vec![[5.0, 0.0], [10.0, 0.0], [10.0, 5.0], [5.0, 5.0]],
            },
        ];
        assert_eq!(assign_cell_to_boundary(2.5, 2.5, &boundaries), Some(0));
        assert_eq!(assign_cell_to_boundary(7.5, 2.5, &boundaries), Some(1));
        assert_eq!(assign_cell_to_boundary(20.0, 20.0, &boundaries), None);
    }

    #[test]
    fn extract_outline_from_quad() {
        let surface = TriSurface {
            name: "test".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(10.0, 10.0, 0.0),
                Vec3::new(0.0, 10.0, 0.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };
        let region = extract_surface_outline(&surface).unwrap();
        assert_eq!(region.polygon.len(), 4);
        let area = polygon_area(&region.polygon);
        assert!((area - 100.0).abs() < 1.0, "Expected area ~100, got {}", area);
    }
}
