use wasm_bindgen::prelude::*;

use crate::boundary::extract_surface_outline;
use crate::classify::{classify_conformance, ConformanceInput, Mode};
use crate::cutfill::{compute_cut_fill, SliverFilter};
use crate::dxf::parse_dxf_polygons;
use crate::format::{decode_surface, decode_surfaces, encode_surfaces};
use crate::types::{BoundaryRegion, TriSurface, Vec3};

#[wasm_bindgen]
pub fn parse_surfaces(data: &[u8]) -> Result<JsValue, JsValue> {
    let surfaces = decode_surfaces(data).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&surfaces).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn encode_surface_pair(surface_a_json: &str, surface_b_json: &str) -> Result<Vec<u8>, JsValue> {
    let a: TriSurface =
        serde_json::from_str(surface_a_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let b: TriSurface =
        serde_json::from_str(surface_b_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(encode_surfaces(&[a, b]))
}

#[wasm_bindgen]
pub fn run_cut_fill(
    data_a: &[u8],
    data_b: &[u8],
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let a = decode_surface(data_a).map_err(|e| JsValue::from_str(&e))?;
    let b = decode_surface(data_b).map_err(|e| JsValue::from_str(&e))?;

    let filter = SliverFilter {
        min_volume_m3: min_volume,
        min_thickness_m: min_thickness,
    };

    let result = compute_cut_fill(&a, &b, filter);

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn run_cut_fill_from_json(
    surface_a_json: &str,
    surface_b_json: &str,
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let a: TriSurface =
        serde_json::from_str(surface_a_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let b: TriSurface =
        serde_json::from_str(surface_b_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let filter = SliverFilter {
        min_volume_m3: min_volume,
        min_thickness_m: min_thickness,
    };

    let result = compute_cut_fill(&a, &b, filter);

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn parse_optional_surface(json: &str) -> Result<Option<TriSurface>, JsValue> {
    if json.is_empty() {
        Ok(None)
    } else {
        serde_json::from_str(json)
            .map(Some)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[wasm_bindgen]
pub fn run_conformance(
    production_start_json: &str,
    production_end_json: &str,
    schedule_start_json: &str,
    schedule_end_json: &str,
    schedule_future_json: &str,
    mode: &str,
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let ps = parse_optional_surface(production_start_json)?;
    let pe = parse_optional_surface(production_end_json)?;
    let ss = parse_optional_surface(schedule_start_json)?;
    let se = parse_optional_surface(schedule_end_json)?;
    let sf = parse_optional_surface(schedule_future_json)?;

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: ps.as_ref(),
        production_end: pe.as_ref(),
        schedule_start: ss.as_ref(),
        schedule_end: se.as_ref(),
        schedule_future: sf.as_ref(),
        mode,
        filter: SliverFilter {
            min_volume_m3: min_volume,
            min_thickness_m: min_thickness,
        },
        boundaries: &[],
    };

    let result = classify_conformance(&input);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn run_conformance_from_binary(
    prod_start_data: &[u8],
    prod_end_data: &[u8],
    sched_start_data: &[u8],
    sched_end_data: &[u8],
    sched_future_data: &[u8],
    mode: &str,
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let ps = if prod_start_data.is_empty() { None } else { Some(decode_surface(prod_start_data).map_err(|e| JsValue::from_str(&e))?) };
    let pe = if prod_end_data.is_empty() { None } else { Some(decode_surface(prod_end_data).map_err(|e| JsValue::from_str(&e))?) };
    let ss = if sched_start_data.is_empty() { None } else { Some(decode_surface(sched_start_data).map_err(|e| JsValue::from_str(&e))?) };
    let se = if sched_end_data.is_empty() { None } else { Some(decode_surface(sched_end_data).map_err(|e| JsValue::from_str(&e))?) };
    let sf = if sched_future_data.is_empty() { None } else { Some(decode_surface(sched_future_data).map_err(|e| JsValue::from_str(&e))?) };

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: ps.as_ref(),
        production_end: pe.as_ref(),
        schedule_start: ss.as_ref(),
        schedule_end: se.as_ref(),
        schedule_future: sf.as_ref(),
        mode,
        filter: SliverFilter {
            min_volume_m3: min_volume,
            min_thickness_m: min_thickness,
        },
        boundaries: &[],
    };

    let result = classify_conformance(&input);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn run_conformance_with_boundaries(
    production_start_json: &str,
    production_end_json: &str,
    schedule_start_json: &str,
    schedule_end_json: &str,
    schedule_future_json: &str,
    mode: &str,
    min_volume: f64,
    min_thickness: f64,
    boundaries_json: &str,
) -> Result<JsValue, JsValue> {
    let ps = parse_optional_surface(production_start_json)?;
    let pe = parse_optional_surface(production_end_json)?;
    let ss = parse_optional_surface(schedule_start_json)?;
    let se = parse_optional_surface(schedule_end_json)?;
    let sf = parse_optional_surface(schedule_future_json)?;

    let boundaries: Vec<BoundaryRegion> =
        serde_json::from_str(boundaries_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: ps.as_ref(),
        production_end: pe.as_ref(),
        schedule_start: ss.as_ref(),
        schedule_end: se.as_ref(),
        schedule_future: sf.as_ref(),
        mode,
        filter: SliverFilter {
            min_volume_m3: min_volume,
            min_thickness_m: min_thickness,
        },
        boundaries: &boundaries,
    };

    let result = classify_conformance(&input);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn parse_dxf(content: &str) -> Result<JsValue, JsValue> {
    let regions = parse_dxf_polygons(content).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&regions).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn extract_boundary_from_surface(data: &[u8]) -> Result<JsValue, JsValue> {
    let surface = decode_surface(data).map_err(|e| JsValue::from_str(&e))?;

    let region = extract_surface_outline(&surface)
        .ok_or_else(|| JsValue::from_str("Could not extract boundary outline from surface"))?;

    serde_wasm_bindgen::to_value(&region).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn extract_boundary_from_surface_json(surface_json: &str) -> Result<JsValue, JsValue> {
    let surface: TriSurface =
        serde_json::from_str(surface_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let region = extract_surface_outline(&surface)
        .ok_or_else(|| JsValue::from_str("Could not extract boundary outline from surface"))?;

    serde_wasm_bindgen::to_value(&region).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn encode_surfaces_from_json(surfaces_json: &str) -> Result<Vec<u8>, JsValue> {
    let surfaces: Vec<TriSurface> =
        serde_json::from_str(surfaces_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(encode_surfaces(&surfaces))
}

fn flatten_vertices(vertices: &[Vec3]) -> Vec<f32> {
    let mut out = Vec::with_capacity(vertices.len() * 3);
    for v in vertices {
        out.push(v.x as f32);
        out.push(v.y as f32);
        out.push(v.z as f32);
    }
    out
}

fn flatten_indices(indices: &[[u32; 3]]) -> Vec<u32> {
    let mut out = Vec::with_capacity(indices.len() * 3);
    for tri in indices {
        out.push(tri[0]);
        out.push(tri[1]);
        out.push(tri[2]);
    }
    out
}

#[wasm_bindgen]
pub fn run_conformance_flat(
    production_start_json: &str,
    production_end_json: &str,
    schedule_start_json: &str,
    schedule_end_json: &str,
    schedule_future_json: &str,
    mode: &str,
    min_volume: f64,
    min_thickness: f64,
    boundaries_json: &str,
) -> Result<JsValue, JsValue> {
    let ps = parse_optional_surface(production_start_json)?;
    let pe = parse_optional_surface(production_end_json)?;
    let ss = parse_optional_surface(schedule_start_json)?;
    let se = parse_optional_surface(schedule_end_json)?;
    let sf = parse_optional_surface(schedule_future_json)?;

    let boundaries: Vec<BoundaryRegion> = if boundaries_json.is_empty() {
        vec![]
    } else {
        serde_json::from_str(boundaries_json).map_err(|e| JsValue::from_str(&e.to_string()))?
    };

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: ps.as_ref(),
        production_end: pe.as_ref(),
        schedule_start: ss.as_ref(),
        schedule_end: se.as_ref(),
        schedule_future: sf.as_ref(),
        mode,
        filter: SliverFilter {
            min_volume_m3: min_volume,
            min_thickness_m: min_thickness,
        },
        boundaries: &boundaries,
    };

    let result = classify_conformance(&input);

    let obj = js_sys::Object::new();

    let summary_val = serde_wasm_bindgen::to_value(&result.summary)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    js_sys::Reflect::set(&obj, &"summary".into(), &summary_val)?;
    js_sys::Reflect::set(&obj, &"mode".into(), &JsValue::from_str(match result.mode {
        Mode::Dig => "dig",
        Mode::Dump => "dump",
    }))?;

    let domains_arr = js_sys::Array::new();
    for d in &result.domains {
        let domain_obj = js_sys::Object::new();
        js_sys::Reflect::set(&domain_obj, &"domain".into(), &JsValue::from_str(&serde_json::to_string(&d.domain).unwrap().trim_matches('"')))?;
        js_sys::Reflect::set(&domain_obj, &"label".into(), &JsValue::from_str(&d.label))?;
        js_sys::Reflect::set(&domain_obj, &"color".into(), &JsValue::from_str(&d.color))?;
        js_sys::Reflect::set(&domain_obj, &"volume".into(), &JsValue::from_f64(d.volume))?;
        js_sys::Reflect::set(&domain_obj, &"surface_area".into(), &JsValue::from_f64(d.solid.surface_area))?;
        js_sys::Reflect::set(&domain_obj, &"vertexCount".into(), &JsValue::from_f64(d.solid.vertices.len() as f64))?;
        js_sys::Reflect::set(&domain_obj, &"triangleCount".into(), &JsValue::from_f64(d.solid.indices.len() as f64))?;

        if let Some(ref bn) = d.block_name {
            js_sys::Reflect::set(&domain_obj, &"block_name".into(), &JsValue::from_str(bn))?;
        }

        let flat_pos = flatten_vertices(&d.solid.vertices);
        let pos_arr = js_sys::Float32Array::new_with_length(flat_pos.len() as u32);
        pos_arr.copy_from(&flat_pos);
        js_sys::Reflect::set(&domain_obj, &"positions".into(), &pos_arr)?;

        let flat_idx = flatten_indices(&d.solid.indices);
        let idx_arr = js_sys::Uint32Array::new_with_length(flat_idx.len() as u32);
        idx_arr.copy_from(&flat_idx);
        js_sys::Reflect::set(&domain_obj, &"indices".into(), &idx_arr)?;

        domains_arr.push(&domain_obj);
    }

    js_sys::Reflect::set(&obj, &"domains".into(), &domains_arr)?;

    Ok(obj.into())
}

#[wasm_bindgen]
pub fn parse_surface_flat(data: &[u8]) -> Result<JsValue, JsValue> {
    let surfaces = decode_surfaces(data).map_err(|e| JsValue::from_str(&e))?;
    if surfaces.is_empty() {
        return Err(JsValue::from_str("No surfaces found"));
    }
    let s = &surfaces[0];

    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"name".into(), &JsValue::from_str(&s.name))?;
    js_sys::Reflect::set(&obj, &"vertexCount".into(), &JsValue::from_f64(s.vertices.len() as f64))?;
    js_sys::Reflect::set(&obj, &"triangleCount".into(), &JsValue::from_f64(s.indices.len() as f64))?;

    let flat_pos = flatten_vertices(&s.vertices);
    let pos_arr = js_sys::Float32Array::new_with_length(flat_pos.len() as u32);
    pos_arr.copy_from(&flat_pos);
    js_sys::Reflect::set(&obj, &"positions".into(), &pos_arr)?;

    let flat_idx = flatten_indices(&s.indices);
    let idx_arr = js_sys::Uint32Array::new_with_length(flat_idx.len() as u32);
    idx_arr.copy_from(&flat_idx);
    js_sys::Reflect::set(&obj, &"indices".into(), &idx_arr)?;

    Ok(obj.into())
}
