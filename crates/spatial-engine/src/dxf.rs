use crate::types::BoundaryRegion;

struct DxfGroup {
    code: i32,
    value: String,
}

fn parse_groups(content: &str) -> Vec<DxfGroup> {
    let lines: Vec<&str> = content.lines().collect();
    let mut groups = Vec::new();
    let mut i = 0;
    while i + 1 < lines.len() {
        let code_str = lines[i].trim();
        let value = lines[i + 1].trim().to_string();
        if let Ok(code) = code_str.parse::<i32>() {
            groups.push(DxfGroup { code, value });
        }
        i += 2;
    }
    groups
}

fn is_mesh_polyline(flags: u32) -> bool {
    // Bit 16 = 3D polygon mesh, bit 64 = polyface mesh
    (flags & 16) != 0 || (flags & 64) != 0
}

fn is_3d_polyline(flags: u32) -> bool {
    // Bit 8 = 3D polyline
    (flags & 8) != 0
}

pub fn parse_dxf_polygons(content: &str) -> Result<Vec<BoundaryRegion>, String> {
    let groups = parse_groups(content);
    let mut regions = Vec::new();
    let mut entity_types = std::collections::HashMap::<String, usize>::new();
    let mut i = 0;

    while i < groups.len() {
        if groups[i].code == 0 {
            *entity_types.entry(groups[i].value.clone()).or_insert(0) += 1;
        }

        if groups[i].code == 0 && groups[i].value == "LWPOLYLINE" {
            i += 1;
            let mut vertices: Vec<[f64; 2]> = Vec::new();
            let mut layer = String::from("Boundary");
            let mut cur_x: Option<f64> = None;

            while i < groups.len() && !(groups[i].code == 0) {
                match groups[i].code {
                    8 => layer = groups[i].value.clone(),
                    10 => {
                        if let Some(x) = cur_x.take() {
                            vertices.push([x, 0.0]);
                        }
                        cur_x = groups[i].value.parse::<f64>().ok();
                    }
                    20 => {
                        if let (Some(x), Ok(y)) = (cur_x.take(), groups[i].value.parse::<f64>()) {
                            vertices.push([x, y]);
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            if let Some(x) = cur_x.take() {
                vertices.push([x, 0.0]);
            }

            if vertices.len() >= 3 {
                dedup_closing_vertex(&mut vertices);
                regions.push(BoundaryRegion {
                    name: layer,
                    polygon: vertices,
                });
            }
        } else if groups[i].code == 0 && groups[i].value == "POLYLINE" {
            i += 1;
            let mut layer = String::from("Boundary");
            let mut flags: u32 = 0;

            while i < groups.len() && groups[i].code != 0 {
                match groups[i].code {
                    8 => layer = groups[i].value.clone(),
                    70 => {
                        if let Ok(f) = groups[i].value.parse::<u32>() {
                            flags = f;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }

            // Skip mesh entities (polyface mesh, polygon mesh)
            if is_mesh_polyline(flags) {
                while i < groups.len() {
                    if groups[i].code == 0 && groups[i].value == "SEQEND" {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
                continue;
            }

            let use_3d = is_3d_polyline(flags);
            let mut vertices: Vec<[f64; 2]> = Vec::new();
            while i < groups.len() {
                if groups[i].code == 0 && groups[i].value == "VERTEX" {
                    i += 1;
                    let mut vx = 0.0f64;
                    let mut vy = 0.0f64;
                    let mut _vz = 0.0f64;
                    let mut vertex_flags: u32 = 0;
                    while i < groups.len() && groups[i].code != 0 {
                        match groups[i].code {
                            10 => {
                                vx = groups[i].value.parse().unwrap_or(0.0);
                            }
                            20 => {
                                vy = groups[i].value.parse().unwrap_or(0.0);
                            }
                            30 => {
                                _vz = groups[i].value.parse().unwrap_or(0.0);
                            }
                            70 => {
                                vertex_flags = groups[i].value.parse().unwrap_or(0);
                            }
                            _ => {}
                        }
                        i += 1;
                    }
                    // Skip spline-fit and curve-fit vertices (flags 1=extra created by curve-fitting,
                    // 8=spline vertex, 16=spline frame control point)
                    if use_3d && (vertex_flags & (1 | 8 | 16)) != 0 {
                        continue;
                    }
                    vertices.push([vx, vy]);
                } else if groups[i].code == 0 && groups[i].value == "SEQEND" {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }

            if vertices.len() >= 3 {
                dedup_closing_vertex(&mut vertices);
                regions.push(BoundaryRegion {
                    name: layer,
                    polygon: vertices,
                });
            }
        } else if groups[i].code == 0 && groups[i].value == "LINE" {
            // Collect consecutive LINE entities on the same layer into a polyline
            let mut layer = String::from("Boundary");
            let mut segments: Vec<([f64; 2], [f64; 2])> = Vec::new();

            while i < groups.len() && groups[i].code == 0 && groups[i].value == "LINE" {
                i += 1;
                let mut x1 = 0.0f64;
                let mut y1 = 0.0f64;
                let mut x2 = 0.0f64;
                let mut y2 = 0.0f64;
                while i < groups.len() && groups[i].code != 0 {
                    match groups[i].code {
                        8 => layer = groups[i].value.clone(),
                        10 => x1 = groups[i].value.parse().unwrap_or(0.0),
                        20 => y1 = groups[i].value.parse().unwrap_or(0.0),
                        11 => x2 = groups[i].value.parse().unwrap_or(0.0),
                        21 => y2 = groups[i].value.parse().unwrap_or(0.0),
                        _ => {}
                    }
                    i += 1;
                }
                segments.push(([x1, y1], [x2, y2]));
            }

            if let Some(polygon) = chain_segments(&segments) {
                if polygon.len() >= 3 {
                    regions.push(BoundaryRegion {
                        name: layer,
                        polygon,
                    });
                }
            }
        } else {
            i += 1;
        }
    }

    if regions.is_empty() {
        let mut found: Vec<String> = entity_types
            .iter()
            .filter(|(k, _)| !matches!(k.as_str(), "SECTION" | "ENDSEC" | "EOF" | "TABLE" | "ENDTAB"))
            .map(|(k, v)| format!("{} (×{})", k, v))
            .collect();
        found.sort();
        if found.is_empty() {
            return Err("No entities found in DXF file. The file may be empty or in an unsupported format.".into());
        }
        return Err(format!(
            "No polygon boundaries found. Entities in file: {}. Supported: LWPOLYLINE, POLYLINE, LINE.",
            found.join(", ")
        ));
    }

    let names: Vec<String> = regions.iter().map(|r| r.name.clone()).collect();
    for (idx, r) in regions.iter_mut().enumerate() {
        if names.iter().filter(|n| *n == &r.name).count() > 1 {
            r.name = format!("{} {}", r.name, idx + 1);
        }
    }

    Ok(regions)
}

fn dedup_closing_vertex(vertices: &mut Vec<[f64; 2]>) {
    if vertices.len() < 2 {
        return;
    }
    let first = vertices[0];
    let last = vertices[vertices.len() - 1];
    if (first[0] - last[0]).abs() < 1e-6 && (first[1] - last[1]).abs() < 1e-6 {
        vertices.pop();
    }
}

fn chain_segments(segments: &[([f64; 2], [f64; 2])]) -> Option<Vec<[f64; 2]>> {
    if segments.is_empty() {
        return None;
    }
    let eps = 1e-4;
    let mut chain = vec![segments[0].0, segments[0].1];
    let mut used = vec![false; segments.len()];
    used[0] = true;

    loop {
        let tail = *chain.last().unwrap();
        let mut found = false;
        for (i, seg) in segments.iter().enumerate() {
            if used[i] {
                continue;
            }
            if (seg.0[0] - tail[0]).abs() < eps && (seg.0[1] - tail[1]).abs() < eps {
                chain.push(seg.1);
                used[i] = true;
                found = true;
                break;
            }
            if (seg.1[0] - tail[0]).abs() < eps && (seg.1[1] - tail[1]).abs() < eps {
                chain.push(seg.0);
                used[i] = true;
                found = true;
                break;
            }
        }
        if !found {
            break;
        }
    }

    dedup_closing_vertex(&mut chain);
    if chain.len() >= 3 { Some(chain) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lwpolyline_closed() {
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nLWPOLYLINE\n  8\nPit1\n  90\n4\n  70\n1\n\
  10\n0.0\n  20\n0.0\n\
  10\n100.0\n  20\n0.0\n\
  10\n100.0\n  20\n100.0\n\
  10\n0.0\n  20\n100.0\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].name, "Pit1");
        assert_eq!(regions[0].polygon.len(), 4);
        assert!((regions[0].polygon[2][0] - 100.0).abs() < 1e-6);
    }

    #[test]
    fn parse_polyline_entities() {
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nPOLYLINE\n  8\nStrip3\n  70\n1\n\
  0\nVERTEX\n  10\n0.0\n  20\n0.0\n\
  0\nVERTEX\n  10\n50.0\n  20\n0.0\n\
  0\nVERTEX\n  10\n50.0\n  20\n50.0\n\
  0\nSEQEND\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].name, "Strip3");
        assert_eq!(regions[0].polygon.len(), 3);
    }

    #[test]
    fn rejects_empty_dxf() {
        let dxf = "  0\nSECTION\n  2\nENTITIES\n  0\nENDSEC\n  0\nEOF";
        let err = parse_dxf_polygons(dxf).unwrap_err();
        assert!(err.contains("No entities found") || err.contains("No polygon"));
    }

    #[test]
    fn multiple_polygons() {
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nLWPOLYLINE\n  8\nA\n  70\n1\n\
  10\n0.0\n  20\n0.0\n  10\n10.0\n  20\n0.0\n  10\n10.0\n  20\n10.0\n\
  0\nLWPOLYLINE\n  8\nB\n  70\n1\n\
  10\n20.0\n  20\n20.0\n  10\n30.0\n  20\n20.0\n  10\n30.0\n  20\n30.0\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn parse_3d_polyline() {
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nPOLYLINE\n  8\nPit\n  70\n9\n\
  0\nVERTEX\n  10\n0.0\n  20\n0.0\n  30\n100.0\n\
  0\nVERTEX\n  10\n50.0\n  20\n0.0\n  30\n100.0\n\
  0\nVERTEX\n  10\n50.0\n  20\n50.0\n  30\n100.0\n\
  0\nSEQEND\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].polygon.len(), 3);
    }

    #[test]
    fn skip_polyface_mesh() {
        // Flag 64 = polyface mesh — should be skipped
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nPOLYLINE\n  8\nMesh\n  70\n64\n\
  0\nVERTEX\n  10\n0.0\n  20\n0.0\n\
  0\nVERTEX\n  10\n10.0\n  20\n0.0\n\
  0\nVERTEX\n  10\n10.0\n  20\n10.0\n\
  0\nSEQEND\n\
  0\nLWPOLYLINE\n  8\nBoundary\n  70\n1\n\
  10\n0.0\n  20\n0.0\n  10\n100.0\n  20\n0.0\n  10\n100.0\n  20\n100.0\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].name, "Boundary");
    }

    #[test]
    fn error_lists_entity_types() {
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\n3DFACE\n  10\n0.0\n  20\n0.0\n  30\n0.0\n\
  0\nENDSEC\n  0\nEOF";

        let err = parse_dxf_polygons(dxf).unwrap_err();
        assert!(err.contains("3DFACE"));
        assert!(err.contains("Supported"));
    }

    #[test]
    fn line_entities_chain_into_polygon() {
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nLINE\n  8\nBdy\n  10\n0.0\n  20\n0.0\n  11\n100.0\n  21\n0.0\n\
  0\nLINE\n  8\nBdy\n  10\n100.0\n  20\n0.0\n  11\n100.0\n  21\n100.0\n\
  0\nLINE\n  8\nBdy\n  10\n100.0\n  20\n100.0\n  11\n0.0\n  21\n100.0\n\
  0\nLINE\n  8\nBdy\n  10\n0.0\n  20\n100.0\n  11\n0.0\n  21\n0.0\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 1);
        assert!(regions[0].polygon.len() >= 3);
    }

    #[test]
    fn lwpolyline_unclosed_duplicate_closing_vertex() {
        // Unclosed flag but last vertex = first vertex
        let dxf = "\
  0\nSECTION\n  2\nENTITIES\n\
  0\nLWPOLYLINE\n  8\nPit\n  70\n0\n\
  10\n0.0\n  20\n0.0\n\
  10\n100.0\n  20\n0.0\n\
  10\n100.0\n  20\n100.0\n\
  10\n0.0\n  20\n0.0\n\
  0\nENDSEC\n  0\nEOF";

        let regions = parse_dxf_polygons(dxf).unwrap();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].polygon.len(), 3);
    }
}
