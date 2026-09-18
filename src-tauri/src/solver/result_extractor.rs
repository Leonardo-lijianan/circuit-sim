// src-tauri/src/solver/result_extractor.rs

use super::context::CircuitContext;
use super::input::{SolverComponent, SolverInput};
use super::matrix_builder::MnaSystem;
use super::models;
use super::output::{SolverError, SolverOutput};
use nalgebra::DVector;
use std::collections::HashMap;

/// 从解向量中提取每个元件的电压、电流、功率
pub fn extract_results(
    input: &SolverInput,
    ctx: &CircuitContext,
    mna: &MnaSystem,
    x: &DVector<f64>,
) -> Result<Vec<SolverOutput>, SolverError> {
    let mut vs_index: HashMap<u32, usize> = HashMap::new();
    for (i, id) in mna.voltage_source_ids.iter().enumerate() {
        vs_index.insert(*id, mna.n_nodes + i);
    }

    let mut outputs = Vec::with_capacity(input.components.len());
    for comp in &input.components {
        outputs.push(extract_one(comp, ctx, mna, x, &vs_index)?);
    }
    Ok(outputs)
}

fn extract_one(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    mna: &MnaSystem,
    x: &DVector<f64>,
    vs_index: &HashMap<u32, usize>,
) -> Result<SolverOutput, SolverError> {
    // GND 元件：全 0
    if comp.func == "ground" {
        return Ok(zero_output(comp.id));
    }

    // 确定正负端引脚 id
    let (pos_pin_id, neg_pin_id): (String, String) = match comp.func.as_str() {
        "voltage_source" => ("pos".to_string(), "neg".to_string()),
        "diode" => ("a".to_string(), "k".to_string()),
        _ => {
            let p0 = comp.pins.get(0).ok_or_else(|| SolverError::MissingPin {
                component_id: comp.id,
                pin_id: "pins[0]".to_string(),
            })?;
            let p1 = comp.pins.get(1).ok_or_else(|| SolverError::MissingPin {
                component_id: comp.id,
                pin_id: "pins[1]".to_string(),
            })?;
            (p0.id.clone(), p1.id.clone())
        }
    };

    // 关联参考方向电压：V = V_pos - V_neg
    let v_pos = get_node_voltage(comp, &pos_pin_id, ctx, mna, x)?;
    let v_neg = get_node_voltage(comp, &neg_pin_id, ctx, mna, x)?;
    let voltage = v_pos - v_neg;

    // 关联参考方向电流
    let current = match comp.func.as_str() {
        "ohm" => {
            let r = models::read_ohm_r(comp);
            voltage / r
        }
        "current_source" => {
            let i = models::read_isource_i(comp)?;
            -i
        }
        "voltage_source" => {
            let k = *vs_index.get(&comp.id).ok_or(SolverError::SingularMatrix)?;
            x[k]
        }
        "diode" => {
            let p = models::read_diode_params(comp);
            if voltage < p.vf {
                models::DIODE_GMIN * voltage
            } else {
                (voltage - p.vf) / p.ron
            }
        }
        "switch" => {
            let p = models::read_switch_params(comp);
            let r = if p.closed { p.ron } else { p.roff };
            voltage / r
        }
        _ => return Err(SolverError::UnknownSolver(comp.func.clone())),
    };

    let power = voltage * current;

    Ok(SolverOutput {
        component_id: comp.id,
        voltage,
        current,
        power,
        node_voltages: None,
    })
}

fn zero_output(id: u32) -> SolverOutput {
    SolverOutput {
        component_id: id,
        voltage: 0.0,
        current: 0.0,
        power: 0.0,
        node_voltages: None,
    }
}

fn get_node_voltage(
    comp: &SolverComponent,
    pin_id: &str,
    ctx: &CircuitContext,
    mna: &MnaSystem,
    x: &DVector<f64>,
) -> Result<f64, SolverError> {
    let key = format!("{}:{}", comp.id, pin_id);
    let node_idx = ctx
        .node_index
        .get(&key)
        .copied()
        .ok_or_else(|| SolverError::MissingPin {
            component_id: comp.id,
            pin_id: pin_id.to_string(),
        })?;

    if ctx.is_ground(node_idx) {
        return Ok(0.0);
    }

    let mat_idx = mna
        .node_matrix_index
        .get(&node_idx)
        .copied()
        .ok_or(SolverError::SingularMatrix)?;

    Ok(x[mat_idx])
}
