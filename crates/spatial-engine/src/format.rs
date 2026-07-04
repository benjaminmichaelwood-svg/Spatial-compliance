use crate::types::{TriSurface, Vec3};

const HEADER_SIZE: usize = 0x78;
const VERTEX_COUNT_OFFSET: usize = 0x48;
const TRIANGLE_COUNT_OFFSET: usize = 0x60;
const VERTEX_START: usize = 0x78;

pub fn decode_surfaces(data: &[u8]) -> Result<Vec<TriSurface>, String> {
    if data.len() < HEADER_SIZE {
        return Err(format!(
            "File too small: {} bytes (minimum {})",
            data.len(),
            HEADER_SIZE
        ));
    }

    let vertex_count = read_be_u32(data, VERTEX_COUNT_OFFSET) as usize;
    let triangle_count = read_be_u32(data, TRIANGLE_COUNT_OFFSET) as usize;

    if vertex_count == 0 {
        return Err("Vertex count is zero".into());
    }

    let tri_start = VERTEX_START + vertex_count * 24;
    let expected_size = tri_start + triangle_count * 24;

    if data.len() < expected_size {
        return Err(format!(
            "File truncated: {} bytes, expected {} (verts={}, tris={})",
            data.len(),
            expected_size,
            vertex_count,
            triangle_count
        ));
    }

    let mut vertices = Vec::with_capacity(vertex_count);
    for i in 0..vertex_count {
        let off = VERTEX_START + i * 24;
        let e = read_be_f64(data, off);
        let n = read_be_f64(data, off + 8);
        let rl = read_be_f64(data, off + 16);
        vertices.push(Vec3::new(e, n, rl));
    }

    let mut indices = Vec::with_capacity(triangle_count);
    for i in 0..triangle_count {
        let off = tri_start + i * 24;
        let i0 = read_be_u32(data, off) as usize;
        let i1 = read_be_u32(data, off + 4) as usize;
        let i2 = read_be_u32(data, off + 8) as usize;

        if i0 < 1 || i1 < 1 || i2 < 1 || i0 > vertex_count || i1 > vertex_count || i2 > vertex_count {
            return Err(format!(
                "Triangle {} has out-of-bounds index: [{}, {}, {}] (vertex_count={})",
                i, i0, i1, i2, vertex_count
            ));
        }

        indices.push([(i0 - 1) as u32, (i1 - 1) as u32, (i2 - 1) as u32]);
    }

    Ok(vec![TriSurface {
        name: String::new(),
        vertices,
        indices,
    }])
}

pub fn decode_surface(data: &[u8]) -> Result<TriSurface, String> {
    decode_surfaces(data).map(|mut v| v.remove(0))
}

pub fn encode_surfaces(surfaces: &[TriSurface]) -> Vec<u8> {
    if surfaces.is_empty() {
        return encode_single(&TriSurface {
            name: String::new(),
            vertices: vec![],
            indices: vec![],
        });
    }
    encode_single(&surfaces[0])
}

pub fn encode_surface(surface: &TriSurface) -> Vec<u8> {
    encode_single(surface)
}

fn encode_single(surface: &TriSurface) -> Vec<u8> {
    let vc = surface.vertices.len();
    let tc = surface.indices.len();
    let tri_start = VERTEX_START + vc * 24;
    let file_size = tri_start + tc * 24;

    let mut buf = vec![0u8; file_size];

    write_be_u32(&mut buf, VERTEX_COUNT_OFFSET, vc as u32);
    write_be_u32(&mut buf, TRIANGLE_COUNT_OFFSET, tc as u32);

    buf[0x22] = 0x01;

    for (i, v) in surface.vertices.iter().enumerate() {
        let off = VERTEX_START + i * 24;
        write_be_f64(&mut buf, off, v.x);
        write_be_f64(&mut buf, off + 8, v.y);
        write_be_f64(&mut buf, off + 16, v.z);
    }

    for (i, tri) in surface.indices.iter().enumerate() {
        let off = tri_start + i * 24;
        write_be_u32(&mut buf, off, tri[0] + 1);
        write_be_u32(&mut buf, off + 4, tri[1] + 1);
        write_be_u32(&mut buf, off + 8, tri[2] + 1);
    }

    buf
}

fn read_be_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_be_f64(data: &[u8], offset: usize) -> f64 {
    f64::from_be_bytes(data[offset..offset + 8].try_into().unwrap())
}

fn write_be_u32(buf: &mut [u8], offset: usize, val: u32) {
    buf[offset..offset + 4].copy_from_slice(&val.to_be_bytes());
}

fn write_be_f64(buf: &mut [u8], offset: usize, val: f64) {
    buf[offset..offset + 8].copy_from_slice(&val.to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encode_decode() {
        let surface = TriSurface {
            name: "test".into(),
            vertices: vec![
                Vec3::new(619758.458, 7534549.950, 328.521),
                Vec3::new(619760.0, 7534550.0, 330.0),
                Vec3::new(619762.0, 7534548.0, 325.0),
                Vec3::new(619756.0, 7534552.0, 327.0),
            ],
            indices: vec![[0, 1, 2], [0, 2, 3]],
        };

        let encoded = encode_surfaces(&[surface.clone()]);
        let decoded = decode_surfaces(&encoded).unwrap();

        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].vertices.len(), 4);
        assert_eq!(decoded[0].indices.len(), 2);

        for (orig, dec) in surface.vertices.iter().zip(decoded[0].vertices.iter()) {
            assert!((orig.x - dec.x).abs() < 1e-12);
            assert!((orig.y - dec.y).abs() < 1e-12);
            assert!((orig.z - dec.z).abs() < 1e-12);
        }

        assert_eq!(decoded[0].indices[0], [0, 1, 2]);
        assert_eq!(decoded[0].indices[1], [0, 2, 3]);
    }

    #[test]
    fn indices_are_zero_based_internally() {
        let surface = TriSurface {
            name: String::new(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            indices: vec![[0, 1, 2]],
        };

        let encoded = encode_surface(&surface);

        let tri_start = VERTEX_START + 3 * 24;
        let i0 = read_be_u32(&encoded, tri_start);
        let i1 = read_be_u32(&encoded, tri_start + 4);
        let i2 = read_be_u32(&encoded, tri_start + 8);
        assert_eq!((i0, i1, i2), (1, 2, 3), "on-disk indices must be 1-indexed");

        let decoded = decode_surface(&encoded).unwrap();
        assert_eq!(decoded.indices[0], [0, 1, 2], "in-memory indices must be 0-indexed");
    }

    #[test]
    fn header_layout() {
        let surface = TriSurface {
            name: String::new(),
            vertices: vec![
                Vec3::new(1.0, 2.0, 3.0),
                Vec3::new(4.0, 5.0, 6.0),
                Vec3::new(7.0, 8.0, 9.0),
            ],
            indices: vec![[0, 1, 2]],
        };

        let encoded = encode_surface(&surface);
        assert_eq!(read_be_u32(&encoded, VERTEX_COUNT_OFFSET), 3);
        assert_eq!(read_be_u32(&encoded, TRIANGLE_COUNT_OFFSET), 1);

        let expected_size = VERTEX_START + 3 * 24 + 1 * 24;
        assert_eq!(encoded.len(), expected_size);
    }

    #[test]
    fn coordinates_are_big_endian_enr() {
        let surface = TriSurface {
            name: String::new(),
            vertices: vec![
                Vec3::new(619758.458, 7534549.950, 328.521),
                Vec3::new(1.0, 2.0, 3.0),
                Vec3::new(4.0, 5.0, 6.0),
            ],
            indices: vec![[0, 1, 2]],
        };

        let encoded = encode_surface(&surface);

        let e = f64::from_be_bytes(encoded[VERTEX_START..VERTEX_START + 8].try_into().unwrap());
        let n = f64::from_be_bytes(encoded[VERTEX_START + 8..VERTEX_START + 16].try_into().unwrap());
        let rl = f64::from_be_bytes(encoded[VERTEX_START + 16..VERTEX_START + 24].try_into().unwrap());
        assert!((e - 619758.458).abs() < 1e-6);
        assert!((n - 7534549.950).abs() < 1e-6);
        assert!((rl - 328.521).abs() < 1e-6);
    }

    #[test]
    fn triangle_padding_is_zeroed() {
        let surface = TriSurface {
            name: String::new(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            indices: vec![[0, 1, 2]],
        };

        let encoded = encode_surface(&surface);
        let tri_start = VERTEX_START + 3 * 24;
        let padding = &encoded[tri_start + 12..tri_start + 24];
        assert!(padding.iter().all(|&b| b == 0), "padding bytes must be zero");
    }

    #[test]
    fn encode_decode_multiple_surfaces_takes_first() {
        let s1 = TriSurface {
            name: "first".into(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            indices: vec![[0, 1, 2]],
        };
        let s2 = TriSurface {
            name: "second".into(),
            vertices: vec![Vec3::new(5.0, 5.0, 5.0)],
            indices: vec![],
        };

        let encoded = encode_surfaces(&[s1.clone(), s2]);
        let decoded = decode_surfaces(&encoded).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].vertices.len(), 3);
    }

    #[test]
    fn rejects_truncated() {
        let data = vec![0u8; 10];
        assert!(decode_surfaces(&data).is_err());
    }

    #[test]
    fn parse_real_file() {
        let data = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/sample.00t")).unwrap();
        let surfaces = decode_surfaces(&data).unwrap();
        assert_eq!(surfaces.len(), 1);
        let s = &surfaces[0];
        assert_eq!(s.vertices.len(), 68259);
        assert_eq!(s.indices.len(), 134906);

        let v0 = s.vertices[0];
        assert!((v0.x - 782209.0).abs() < 1.0, "Easting out of range");
        assert!((v0.y - 7331441.0).abs() < 1.0, "Northing out of range");
        assert!((v0.z - 93.289).abs() < 1.0, "RL out of range");

        assert_eq!(s.indices[0], [0, 1, 2]);
        assert_eq!(s.indices[1], [0, 2, 3]);

        for tri in &s.indices {
            for &idx in tri {
                assert!((idx as usize) < s.vertices.len());
            }
        }
    }

    #[test]
    fn roundtrip_real_file() {
        let data = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/sample.00t")).unwrap();
        let surfaces = decode_surfaces(&data).unwrap();
        let s = &surfaces[0];

        let encoded = encode_surface(s);
        let re_decoded = decode_surface(&encoded).unwrap();

        assert_eq!(re_decoded.vertices.len(), s.vertices.len());
        assert_eq!(re_decoded.indices.len(), s.indices.len());

        for (a, b) in s.vertices.iter().zip(re_decoded.vertices.iter()) {
            assert!((a.x - b.x).abs() < 1e-12);
            assert!((a.y - b.y).abs() < 1e-12);
            assert!((a.z - b.z).abs() < 1e-12);
        }

        for (a, b) in s.indices.iter().zip(re_decoded.indices.iter()) {
            assert_eq!(a, b);
        }
    }

    #[test]
    fn rejects_bad_index() {
        let surface = TriSurface {
            name: String::new(),
            vertices: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            indices: vec![[0, 1, 2]],
        };
        let mut encoded = encode_surface(&surface);
        let tri_start = VERTEX_START + 3 * 24;
        write_be_u32(&mut encoded, tri_start, 99);
        assert!(decode_surfaces(&encoded).is_err());
    }
}
