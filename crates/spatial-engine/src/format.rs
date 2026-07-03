use crate::types::{TriSurface, Vec3};

/// Mock Vulcan .00t binary format:
///
/// ```text
/// Offset  Size    Field
/// 0       16      Magic: "VULCAN_TRI\0" (padded to 16 bytes)
/// 16      4       Version (u32 LE) = 1
/// 20      4       Object count (u32 LE)
///
/// Per object:
///   0     64      Name (null-terminated, padded to 64 bytes)
///   64    4       Vertex count (u32 LE)
///   68    4       Triangle count (u32 LE)
///   72    N*24    Vertices: N x (f64 LE x, f64 LE y, f64 LE z)
///   72+N*24 M*12  Triangles: M x (u32 LE i0, u32 LE i1, u32 LE i2)
/// ```
const MAGIC: &[u8; 16] = b"VULCAN_TRI\0\0\0\0\0\0";
const VERSION: u32 = 1;
const NAME_LEN: usize = 64;
const HEADER_SIZE: usize = 16 + 4 + 4; // magic + version + object_count

pub fn encode_surfaces(surfaces: &[TriSurface]) -> Vec<u8> {
    let mut total_size = HEADER_SIZE;
    for s in surfaces {
        total_size += NAME_LEN + 4 + 4 + s.vertices.len() * 24 + s.indices.len() * 12;
    }

    let mut buf = Vec::with_capacity(total_size);

    buf.extend_from_slice(MAGIC);
    buf.extend_from_slice(&VERSION.to_le_bytes());
    buf.extend_from_slice(&(surfaces.len() as u32).to_le_bytes());

    for surface in surfaces {
        let mut name_bytes = [0u8; NAME_LEN];
        let name = surface.name.as_bytes();
        let copy_len = name.len().min(NAME_LEN - 1);
        name_bytes[..copy_len].copy_from_slice(&name[..copy_len]);
        buf.extend_from_slice(&name_bytes);

        buf.extend_from_slice(&(surface.vertices.len() as u32).to_le_bytes());
        buf.extend_from_slice(&(surface.indices.len() as u32).to_le_bytes());

        for v in &surface.vertices {
            buf.extend_from_slice(&v.x.to_le_bytes());
            buf.extend_from_slice(&v.y.to_le_bytes());
            buf.extend_from_slice(&v.z.to_le_bytes());
        }

        for tri in &surface.indices {
            buf.extend_from_slice(&tri[0].to_le_bytes());
            buf.extend_from_slice(&tri[1].to_le_bytes());
            buf.extend_from_slice(&tri[2].to_le_bytes());
        }
    }

    buf
}

pub fn decode_surfaces(data: &[u8]) -> Result<Vec<TriSurface>, String> {
    if data.len() < HEADER_SIZE {
        return Err("File too small for header".into());
    }

    if &data[..16] != MAGIC {
        return Err("Invalid magic bytes — not a VULCAN_TRI file".into());
    }

    let version = u32::from_le_bytes(data[16..20].try_into().unwrap());
    if version != VERSION {
        return Err(format!("Unsupported version: {version}"));
    }

    let object_count = u32::from_le_bytes(data[20..24].try_into().unwrap()) as usize;
    let mut offset = HEADER_SIZE;
    let mut surfaces = Vec::with_capacity(object_count);

    for obj_idx in 0..object_count {
        if offset + NAME_LEN + 8 > data.len() {
            return Err(format!("Truncated object header at object {obj_idx}"));
        }

        let name_raw = &data[offset..offset + NAME_LEN];
        let name_end = name_raw.iter().position(|&b| b == 0).unwrap_or(NAME_LEN);
        let name = String::from_utf8_lossy(&name_raw[..name_end]).to_string();
        offset += NAME_LEN;

        let vert_count = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        let tri_count = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;

        let vert_bytes = vert_count * 24;
        if offset + vert_bytes > data.len() {
            return Err(format!("Truncated vertex data at object {obj_idx}"));
        }

        let mut vertices = Vec::with_capacity(vert_count);
        for i in 0..vert_count {
            let base = offset + i * 24;
            let x = f64::from_le_bytes(data[base..base + 8].try_into().unwrap());
            let y = f64::from_le_bytes(data[base + 8..base + 16].try_into().unwrap());
            let z = f64::from_le_bytes(data[base + 16..base + 24].try_into().unwrap());
            vertices.push(Vec3::new(x, y, z));
        }
        offset += vert_bytes;

        let tri_bytes = tri_count * 12;
        if offset + tri_bytes > data.len() {
            return Err(format!("Truncated triangle data at object {obj_idx}"));
        }

        let mut indices = Vec::with_capacity(tri_count);
        for i in 0..tri_count {
            let base = offset + i * 12;
            let i0 = u32::from_le_bytes(data[base..base + 4].try_into().unwrap());
            let i1 = u32::from_le_bytes(data[base + 4..base + 8].try_into().unwrap());
            let i2 = u32::from_le_bytes(data[base + 8..base + 12].try_into().unwrap());

            if i0 as usize >= vert_count || i1 as usize >= vert_count || i2 as usize >= vert_count
            {
                return Err(format!(
                    "Triangle index out of bounds at object {obj_idx}, tri {i}"
                ));
            }
            indices.push([i0, i1, i2]);
        }
        offset += tri_bytes;

        surfaces.push(TriSurface {
            name,
            vertices,
            indices,
        });
    }

    Ok(surfaces)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encode_decode() {
        let surface = TriSurface {
            name: "test_surface".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(10.0, 10.0, 0.0),
                Vec3::new(0.0, 10.0, 0.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let encoded = encode_surfaces(&[surface.clone()]);
        let decoded = decode_surfaces(&encoded).unwrap();

        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "test_surface");
        assert_eq!(decoded[0].vertices.len(), 4);
        assert_eq!(decoded[0].indices.len(), 2);

        for (orig, dec) in surface.vertices.iter().zip(decoded[0].vertices.iter()) {
            assert!((orig.x - dec.x).abs() < 1e-12);
            assert!((orig.y - dec.y).abs() < 1e-12);
            assert!((orig.z - dec.z).abs() < 1e-12);
        }
    }

    #[test]
    fn multiple_surfaces_roundtrip() {
        let s1 = TriSurface {
            name: "upper".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 5.0),
                Vec3::new(10.0, 0.0, 5.0),
                Vec3::new(5.0, 10.0, 5.0),
            ],
            indices: vec![[0, 1, 2]],
        };
        let s2 = TriSurface {
            name: "lower".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(5.0, 10.0, 0.0),
            ],
            indices: vec![[0, 1, 2]],
        };

        let encoded = encode_surfaces(&[s1, s2]);
        let decoded = decode_surfaces(&encoded).unwrap();
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].name, "upper");
        assert_eq!(decoded[1].name, "lower");
    }

    #[test]
    fn rejects_bad_magic() {
        let mut data = vec![0u8; 100];
        data[..5].copy_from_slice(b"WRONG");
        assert!(decode_surfaces(&data).is_err());
    }

    #[test]
    fn rejects_truncated() {
        let data = b"VULCAN_TRI\0\0\0\0\0\0";
        assert!(decode_surfaces(data).is_err());
    }
}
