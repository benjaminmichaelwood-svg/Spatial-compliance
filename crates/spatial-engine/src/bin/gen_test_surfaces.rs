use spatial_engine::format::encode_surface;
use spatial_engine::types::{TriSurface, Vec3};
use std::fs;
use std::path::Path;

fn terrain_z(x: f64, y: f64) -> f64 {
    let base = 200.0;
    let ridge = 15.0 * (x * 0.005).sin() * (y * 0.003).cos();
    let slope = -0.02 * x + 0.01 * y;
    let noise = 2.0 * ((x * 0.05).sin() * (y * 0.07).cos());
    base + ridge + slope + noise
}

fn make_grid_surface(name: &str, grid: usize, z_func: impl Fn(f64, f64) -> f64) -> TriSurface {
    let step = 5.0;
    let n = grid + 1;
    let mut vertices = Vec::with_capacity(n * n);
    for row in 0..n {
        for col in 0..n {
            let x = col as f64 * step;
            let y = row as f64 * step;
            vertices.push(Vec3::new(x, y, z_func(x, y)));
        }
    }
    let mut indices = Vec::with_capacity(grid * grid * 2);
    for row in 0..grid {
        for col in 0..grid {
            let tl = (row * n + col) as u32;
            let tr = tl + 1;
            let bl = tl + n as u32;
            let br = bl + 1;
            indices.push([tl, bl, tr]);
            indices.push([tr, bl, br]);
        }
    }
    TriSurface { name: name.to_string(), vertices, indices }
}

fn main() {
    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-data");
    fs::create_dir_all(&out_dir).unwrap();

    let grid = 200;

    let ps = make_grid_surface("production_start", grid, terrain_z);
    println!(
        "production_start: {} vertices, {} triangles",
        ps.vertices.len(),
        ps.indices.len()
    );

    let pe = make_grid_surface("production_end", grid, |x, y| {
        let base_z = terrain_z(x, y);
        let cx = 500.0;
        let cy = 500.0;
        let dx = x - cx;
        let dy = y - cy;
        let dist = (dx * dx + dy * dy).sqrt();
        let pit_radius = 300.0;
        if dist < pit_radius {
            let depth = 25.0 * (1.0 - (dist / pit_radius).powi(2));
            let bench = (depth / 5.0).floor() * 5.0;
            base_z - bench.max(0.0)
        } else {
            base_z
        }
    });
    println!(
        "production_end: {} vertices, {} triangles",
        pe.vertices.len(),
        pe.indices.len()
    );

    let ss = make_grid_surface("schedule_start", grid, terrain_z);

    let se = make_grid_surface("schedule_end", grid, |x, y| {
        let base_z = terrain_z(x, y);
        let cx = 500.0;
        let cy = 500.0;
        let dx = x - cx;
        let dy = y - cy;
        let dist = (dx * dx + dy * dy).sqrt();
        let pit_radius = 350.0;
        if dist < pit_radius {
            let depth = 30.0 * (1.0 - (dist / pit_radius).powi(2));
            base_z - depth.max(0.0)
        } else {
            base_z
        }
    });

    let paths = [
        ("production_start.00t", &ps),
        ("production_end.00t", &pe),
        ("schedule_start.00t", &ss),
        ("schedule_end.00t", &se),
    ];

    for (filename, surface) in &paths {
        let data = encode_surface(surface);
        let path = out_dir.join(filename);
        fs::write(&path, &data).unwrap();
        let size_kb = data.len() / 1024;
        println!("Wrote {} ({} KB)", path.display(), size_kb);
    }
}
