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

pub fn parse_dxf_polygons(content: &str) -> Result<Vec<BoundaryRegion>, String> {
    let groups = parse_groups(content);
    let mut regions = Vec::new();
    let mut i = 0;

    while i < groups.len() {
        if groups[i].code == 0 && groups[i].value == "LWPOLYLINE" {
            i += 1;
            let mut vertices: Vec<[f64; 2]> = Vec::new();
            let mut closed = false;
            let mut layer = String::from("Boundary");
            let mut cur_x: Option<f64> = None;

            while i < groups.len() && !(groups[i].code == 0) {
                match groups[i].code {
                    8 => layer = groups[i].value.clone(),
                    70 => {
                        if let Ok(flags) = groups[i].value.parse::<u32>() {
                            closed = (flags & 1) != 0;
                        }
                    }
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
                if closed {
                    let first = vertices[0];
                    let last = vertices[vertices.len() - 1];
                    if (first[0] - last[0]).abs() < 1e-6 && (first[1] - last[1]).abs() < 1e-6 {
                        vertices.pop();
                    }
                }
                regions.push(BoundaryRegion {
                    name: layer,
                    polygon: vertices,
                });
            }
        } else if groups[i].code == 0 && groups[i].value == "POLYLINE" {
            i += 1;
            let mut closed = false;
            let mut layer = String::from("Boundary");

            while i < groups.len() && groups[i].code != 0 {
                match groups[i].code {
                    8 => layer = groups[i].value.clone(),
                    70 => {
                        if let Ok(flags) = groups[i].value.parse::<u32>() {
                            closed = (flags & 1) != 0;
                        }
                    }
                    _ => {}
                }
                i += 1;
            }

            let mut vertices: Vec<[f64; 2]> = Vec::new();
            while i < groups.len() {
                if groups[i].code == 0 && groups[i].value == "VERTEX" {
                    i += 1;
                    let mut vx = 0.0f64;
                    let mut vy = 0.0f64;
                    while i < groups.len() && groups[i].code != 0 {
                        match groups[i].code {
                            10 => {
                                vx = groups[i].value.parse().unwrap_or(0.0);
                            }
                            20 => {
                                vy = groups[i].value.parse().unwrap_or(0.0);
                            }
                            _ => {}
                        }
                        i += 1;
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
                if closed {
                    let first = vertices[0];
                    let last = vertices[vertices.len() - 1];
                    if (first[0] - last[0]).abs() < 1e-6 && (first[1] - last[1]).abs() < 1e-6 {
                        vertices.pop();
                    }
                }
                regions.push(BoundaryRegion {
                    name: layer,
                    polygon: vertices,
                });
            }
        } else {
            i += 1;
        }
    }

    if regions.is_empty() {
        return Err("No polygons found in DXF file".into());
    }

    let names: Vec<String> = regions.iter().map(|r| r.name.clone()).collect();
    for (idx, r) in regions.iter_mut().enumerate() {
        if names.iter().filter(|n| *n == &r.name).count() > 1 {
            r.name = format!("{} {}", r.name, idx + 1);
        }
    }

    Ok(regions)
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
        assert!(parse_dxf_polygons(dxf).is_err());
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
}
