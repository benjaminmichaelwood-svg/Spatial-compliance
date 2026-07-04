use wasm_bindgen::prelude::*;

use crate::boundary::extract_surface_outline;
use crate::classify::{classify_conformance, ConformanceInput, Mode};
use crate::cutfill::{compute_cut_fill, SliverFilter};
use crate::dxf::parse_dxf_polygons;
use crate::format::{decode_surfaces, encode_surfaces};
use crate::types::{BoundaryRegion, TriSurface};

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
    data: &[u8],
    resolution: u32,
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let surfaces = decode_surfaces(data).map_err(|e| JsValue::from_str(&e))?;

    if surfaces.len() < 2 {
        return Err(JsValue::from_str(
            "Need at least 2 surfaces in the file (design + actual)",
        ));
    }

    let filter = SliverFilter {
        min_volume_m3: min_volume,
        min_thickness_m: min_thickness,
    };

    let result = compute_cut_fill(&surfaces[0], &surfaces[1], resolution as usize, filter);

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn run_cut_fill_from_json(
    surface_a_json: &str,
    surface_b_json: &str,
    resolution: u32,
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

    let result = compute_cut_fill(&a, &b, resolution as usize, filter);

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn run_conformance(
    production_start_json: &str,
    production_end_json: &str,
    schedule_start_json: &str,
    schedule_end_json: &str,
    schedule_future_json: &str,
    mode: &str,
    resolution: u32,
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let ps: TriSurface =
        serde_json::from_str(production_start_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let pe: TriSurface =
        serde_json::from_str(production_end_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let ss: TriSurface =
        serde_json::from_str(schedule_start_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let se: TriSurface =
        serde_json::from_str(schedule_end_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let sf: TriSurface =
        serde_json::from_str(schedule_future_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: &ps,
        production_end: &pe,
        schedule_start: &ss,
        schedule_end: &se,
        schedule_future: &sf,
        mode,
        resolution: resolution as usize,
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
    data: &[u8],
    mode: &str,
    resolution: u32,
    min_volume: f64,
    min_thickness: f64,
) -> Result<JsValue, JsValue> {
    let surfaces = decode_surfaces(data).map_err(|e| JsValue::from_str(&e))?;

    if surfaces.len() < 5 {
        return Err(JsValue::from_str(
            "Need at least 5 surfaces: Production Start, Production End, Schedule Start, Schedule End, Schedule Future",
        ));
    }

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: &surfaces[0],
        production_end: &surfaces[1],
        schedule_start: &surfaces[2],
        schedule_end: &surfaces[3],
        schedule_future: &surfaces[4],
        mode,
        resolution: resolution as usize,
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
    resolution: u32,
    min_volume: f64,
    min_thickness: f64,
    boundaries_json: &str,
) -> Result<JsValue, JsValue> {
    let ps: TriSurface =
        serde_json::from_str(production_start_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let pe: TriSurface =
        serde_json::from_str(production_end_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let ss: TriSurface =
        serde_json::from_str(schedule_start_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let se: TriSurface =
        serde_json::from_str(schedule_end_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let sf: TriSurface =
        serde_json::from_str(schedule_future_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let boundaries: Vec<BoundaryRegion> =
        serde_json::from_str(boundaries_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mode = match mode {
        "dig" => Mode::Dig,
        "dump" => Mode::Dump,
        _ => return Err(JsValue::from_str("mode must be 'dig' or 'dump'")),
    };

    let input = ConformanceInput {
        production_start: &ps,
        production_end: &pe,
        schedule_start: &ss,
        schedule_end: &se,
        schedule_future: &sf,
        mode,
        resolution: resolution as usize,
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
    let surfaces = decode_surfaces(data).map_err(|e| JsValue::from_str(&e))?;

    if surfaces.is_empty() {
        return Err(JsValue::from_str("No surfaces found in file"));
    }

    let region = extract_surface_outline(&surfaces[0])
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
