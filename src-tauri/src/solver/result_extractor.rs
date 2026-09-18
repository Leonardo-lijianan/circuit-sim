// src-tauri/src/solver/result_extractor.rs

use super::context::CircuitContext;
use super::input::{SolverComponent, SolverInput};
use super::matrix_builder::MnaSystem;
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
    // 电压源 id → 在 x 中的位置
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
    // GND 元件：直接返回全 0
    if comp.func == "ground" {
        return Ok(SolverOutput {
            component_id: comp.id,
            voltage: 0.0,
            current: 0.0,
            power: 0.0,
            node_voltages: None,
        });
    }

    // 1. 确定正负端引脚 id
    //    - 极性元件（voltage_source）：按引脚 id 取 pos/neg
    //    - 无极性元件：按 pins[0] / pins[1] 顺序
    let (pos_pin_id, neg_pin_id): (String, String) = match comp.func.as_str() {
        "voltage_source" => ("pos".to_string(), "neg".to_string()),
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

    // 2. 两端电压（关联参考方向：V_pos - V_neg）
    let v_pos = get_node_voltage(comp, &pos_pin_id, ctx, mna, x)?;
    let v_neg = get_node_voltage(comp, &neg_pin_id, ctx, mna, x)?;
    let voltage = v_pos - v_neg;

    // 3. 关联参考方向电流（从 pos 流入，从 neg 流出）
    let current = match comp.func.as_str() {
        "ohm" => {
            let r = get_param_f64(comp, "R")?;
            voltage / r
        }
        "current_source" => {
            // 参数 I 定义为从 pins[0] 流出的电流
            // 关联方向（从 pos 流入）= -I
            -get_param_f64(comp, "I")?
        }
        "voltage_source" => {
            // x[k] 的实际语义：从外部流入 pos 端的电流（即关联参考方向电流）
            let k = *vs_index.get(&comp.id).ok_or(SolverError::SingularMatrix)?;
            x[k]
        }
        "diode" => {
            // Shockley 方程：I = Is·(exp(V/nVt) - 1)，V = V_a - V_k
            const DIODE_IS: f64 = 1e-12;
            const DIODE_NVT: f64 = 0.02585;
            const V_MAX: f64 = 0.8;
            const V_MIN: f64 = -5.0;
            let v_clamped = voltage.clamp(V_MIN, V_MAX);
            DIODE_IS * ((v_clamped / DIODE_NVT).exp() - 1.0)
        }
        _ => return Err(SolverError::UnknownSolver(comp.func.clone())),
    };

    // 4. 功率（关联参考方向下 P>0 表示吸收）
    let power = voltage * current;

    Ok(SolverOutput {
        component_id: comp.id,
        voltage,
        current,
        power,
        node_voltages: None,
    })
}

/// 获取引脚对应的节点电压（地节点 → 0）
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

    if node_idx == ctx.ground_index {
        return Ok(0.0);
    }

    let mat_idx = mna
        .node_matrix_index
        .get(&node_idx)
        .copied()
        .ok_or(SolverError::SingularMatrix)?;

    Ok(x[mat_idx])
}

fn get_param_f64(comp: &SolverComponent, key: &str) -> Result<f64, SolverError> {
    comp.params
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| SolverError::MissingParam {
            component_id: comp.id,
            param: key.to_string(),
        })
}
