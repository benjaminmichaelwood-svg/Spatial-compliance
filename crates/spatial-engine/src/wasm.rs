use wasm_bindgen::prelude::*;

use crate::cutfill::{compute_cut_fill, SliverFilter};
use crate::format::{decode_surfaces, encode_surfaces};
use crate::types::TriSurface;

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

    let result = compute_cut_fill(
        &surfaces[0],
        &surfaces[1],
        resolution as usize,
        filter,
    );

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
