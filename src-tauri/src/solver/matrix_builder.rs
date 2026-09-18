// src-tauri/src/solver/matrix_builder.rs

use super::context::CircuitContext;
use super::input::{SolverComponent, SolverInput};
use super::output::SolverError;
use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

/// MNA 系统（矩阵 + 元数据）
///
/// 未知量 x 排列：
///   x[0..n_nodes]        : 非地节点电压
///   x[n_nodes..n_nodes+n_vs] : 电压源电流（按 voltage_source_ids 顺序）
pub struct MnaSystem {
    pub a: DMatrix<f64>,
    pub b: DVector<f64>,
    /// node_index（来自 CircuitContext）→ 矩阵行列索引（0-based，跳过地节点）
    pub node_matrix_index: HashMap<usize, usize>,
    /// 电压源元件 id，按 x 中的出现顺序（决定 x 中哪个位置是它的电流）
    pub voltage_source_ids: Vec<u32>,
    /// 非地节点数
    pub n_nodes: usize,
}

/// 二极管模型常数
const DIODE_IS: f64 = 1e-12;       // 反向饱和电流 (A)
const DIODE_NVT: f64 = 0.02585;    // 热电压 nVt (V)
const DIODE_V_MAX: f64 = 0.8;      // 正向上限（避免 exp 溢出）
const DIODE_V_MIN: f64 = -5.0;     // 反向下限

/// 构建 MNA 方程组
/// 
/// v_guess: 非线性元件线性化时用的工作点（node_index → 电压）；
///          线性电路传空 HashMap 即可
pub fn build_mna(
    input: &SolverInput,
    ctx: &CircuitContext,
    v_guess: &HashMap<usize, f64>,
) -> Result<MnaSystem, SolverError> {
    // 1. 节点重映射：node_index → matrix_index（跳过地节点）
    let mut node_matrix_index: HashMap<usize, usize> = HashMap::new();
    let mut next_idx = 0;
    for i in 0..ctx.node_count {
        if i == ctx.ground_index {
            continue;
        }
        node_matrix_index.insert(i, next_idx);
        next_idx += 1;
    }
    let n_nodes = next_idx;

    // 2. 收集电压源元件（保持输入顺序）
    let mut voltage_source_ids: Vec<u32> = Vec::new();
    for comp in &input.components {
        if comp.func == "voltage_source" {
            voltage_source_ids.push(comp.id);
        }
    }
    let n_vs = voltage_source_ids.len();

    // 3. 矩阵尺寸：n_nodes + n_vs
    let size = n_nodes + n_vs;
    let mut a = DMatrix::<f64>::zeros(size, size);
    let mut b = DVector::<f64>::zeros(size);

    // 4. 逐个元件填充
    let mut vs_counter = 0;
    for comp in &input.components {
        match comp.func.as_str() {
            "ohm" => {
                fill_ohm(comp, ctx, &node_matrix_index, &mut a)?;
            }
            "voltage_source" => {
                let k = n_nodes + vs_counter;
                fill_voltage_source(comp, ctx, &node_matrix_index, k, &mut a, &mut b)?;
                vs_counter += 1;
            }
            "current_source" => {
                fill_current_source(comp, ctx, &node_matrix_index, &mut b)?;
            }
            "diode" => {
                fill_diode(comp, ctx, &node_matrix_index, v_guess, &mut a, &mut b)?;
            }
            "ground" => {
                // GND 不产生贡献，仅作为节点标记
            }
            _ => {
                return Err(SolverError::UnknownSolver(comp.func.clone()));
            }
        }
    }

    Ok(MnaSystem {
        a,
        b,
        node_matrix_index,
        voltage_source_ids,
        n_nodes,
    })
}

// ============================================================
// 各元件的填充函数
// ============================================================

/// 电阻：G = 1/R，关联参考方向（pins[0] → pins[1] 为正）
fn fill_ohm(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    a: &mut DMatrix<f64>,
) -> Result<(), SolverError> {
    let r = get_param_f64(comp, "R")?;
    if r <= 0.0 {
        return Err(SolverError::SingularMatrix);
    }
    let g = 1.0 / r;

    let pin_a = comp.pins.get(0).ok_or_else(|| SolverError::MissingPin {
        component_id: comp.id,
        pin_id: "pins[0]".to_string(),
    })?;
    let pin_b = comp.pins.get(1).ok_or_else(|| SolverError::MissingPin {
        component_id: comp.id,
        pin_id: "pins[1]".to_string(),
    })?;

    let node_a = get_pin_node(comp, &pin_a.id, ctx)?;
    let node_b = get_pin_node(comp, &pin_b.id, ctx)?;

    let ma = n2m.get(&node_a).copied();
    let mb = n2m.get(&node_b).copied();

    match (ma, mb) {
        (Some(i), Some(j)) => {
            a[(i, i)] += g;
            a[(j, j)] += g;
            a[(i, j)] -= g;
            a[(j, i)] -= g;
        }
        (Some(i), None) => {
            // b 端接地，只填 i 行
            a[(i, i)] += g;
        }
        (None, Some(j)) => {
            // a 端接地
            a[(j, j)] += g;
        }
        (None, None) => {
            // 两端都接地（短路），对电流无影响，忽略
        }
    }

    Ok(())
}

/// 电压源：固定 V_pos - V_neg = V_source
/// 电流从 pos 流出、从 neg 流入（关联参考方向的反面，因为电压源是发出功率的元件）
/// 引入新未知量 I_k = 电压源向外输出的电流
fn fill_voltage_source(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    k: usize,
    a: &mut DMatrix<f64>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    let v = get_param_f64(comp, "V")?;

    // 按引脚 id 查找正负端（不依赖 pins 数组顺序）
    let pos_pin = comp.pins.iter().find(|p| p.id == "pos").ok_or_else(|| {
        SolverError::MissingPin { component_id: comp.id, pin_id: "pos".to_string() }
    })?;
    let neg_pin = comp.pins.iter().find(|p| p.id == "neg").ok_or_else(|| {
        SolverError::MissingPin { component_id: comp.id, pin_id: "neg".to_string() }
    })?;

    let node_pos = get_pin_node(comp, &pos_pin.id, ctx)?;
    let node_neg = get_pin_node(comp, &neg_pin.id, ctx)?;

    let mp = n2m.get(&node_pos).copied();
    let mn = n2m.get(&node_neg).copied();

    // 约束行（第 k 行）：V_pos - V_neg = V_source
    match (mp, mn) {
        (Some(i), Some(j)) => {
            a[(k, i)] += 1.0;
            a[(k, j)] -= 1.0;
        }
        (Some(i), None) => {
            a[(k, i)] += 1.0;
        }
        (None, Some(j)) => {
            a[(k, j)] -= 1.0;
        }
        (None, None) => {
            // 两端都接地 → 短路电压源，无解
            return Err(SolverError::SingularMatrix);
        }
    }
    b[k] = v;

    // KCL 贡献（第 k 列）：x[k] = 从外部流入 pos 端的电流（关联参考方向）
    // pos 节点流出项里 +x[k]（流入取负，移到 KCL 流出方程左边就是 +）
    // neg 节点流出项里 -x[k]
    if let Some(i) = mp {
        a[(i, k)] += 1.0;
    }
    if let Some(j) = mn {
        a[(j, k)] -= 1.0;
    }

    Ok(())
}

/// 电流源：从 pins[0] 流出，从 pins[1] 流入（关联参考方向）
fn fill_current_source(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    let current = get_param_f64(comp, "I")?;

    let pin_a = comp.pins.get(0).ok_or_else(|| SolverError::MissingPin {
        component_id: comp.id,
        pin_id: "pins[0]".to_string(),
    })?;
    let pin_b = comp.pins.get(1).ok_or_else(|| SolverError::MissingPin {
        component_id: comp.id,
        pin_id: "pins[1]".to_string(),
    })?;

    let node_a = get_pin_node(comp, &pin_a.id, ctx)?;
    let node_b = get_pin_node(comp, &pin_b.id, ctx)?;

    // KCL "流出 = 0" 移项到右边：
    //   节点 a：电流源从 a 端流出 current（流入节点 a）→ 移项后 b[a] = +current
    //   节点 b：电流源从 b 端流入 current（流出节点 b）→ 移项后 b[b] = -current
    if let Some(mat_a) = n2m.get(&node_a).copied() {
        b[mat_a] += current;
    }
    if let Some(mat_b) = n2m.get(&node_b).copied() {
        b[mat_b] -= current;
    }

    Ok(())
}

/// 二极管：Shockley 方程 I = Is·(exp(V/nVt) - 1)
/// 线性化后：I ≈ G_d·V + I_eq
///   其中 G_d = Is/(nVt)·exp(V0/nVt) 是动态电导
///        I_eq = I_d(V0) - G_d·V0 是等效电流源
fn fill_diode(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    v_guess: &HashMap<usize, f64>,
    a: &mut DMatrix<f64>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    // 二极管引脚：a (anode) / k (cathode)
    let a_pin = comp.pins.iter().find(|p| p.id == "a").ok_or_else(|| {
        SolverError::MissingPin { component_id: comp.id, pin_id: "a".to_string() }
    })?;
    let k_pin = comp.pins.iter().find(|p| p.id == "k").ok_or_else(|| {
        SolverError::MissingPin { component_id: comp.id, pin_id: "k".to_string() }
    })?;

    let node_a = get_pin_node(comp, &a_pin.id, ctx)?;
    let node_k = get_pin_node(comp, &k_pin.id, ctx)?;

    // 当前工作点电压
    let v_a = get_guess(node_a, ctx, v_guess);
    let v_k = get_guess(node_k, ctx, v_guess);
    let v = v_a - v_k;
    let v_clamped = v.clamp(DIODE_V_MIN, DIODE_V_MAX);

    // 二极管模型
    let exp_term = (v_clamped / DIODE_NVT).exp();
    let i_d = DIODE_IS * (exp_term - 1.0);
    let g_d = DIODE_IS / DIODE_NVT * exp_term;

    // 线性化等效电流源
    let i_eq = i_d - g_d * v_clamped;

    let ma = n2m.get(&node_a).copied();
    let mk = n2m.get(&node_k).copied();

    // 电导矩阵贡献
    match (ma, mk) {
        (Some(i), Some(j)) => {
            a[(i, i)] += g_d;
            a[(j, j)] += g_d;
            a[(i, j)] -= g_d;
            a[(j, i)] -= g_d;
        }
        (Some(i), None) => {
            a[(i, i)] += g_d;
        }
        (None, Some(j)) => {
            a[(j, j)] += g_d;
        }
        (None, None) => {}
    }

    // 等效电流源贡献（I_d 从 a 流出，从 k 流入）
    // 节点 a: I_d 从 a 流出 → b[a] -= i_eq
    // 节点 k: I_d 从 k 流入 → b[k] += i_eq
    if let Some(i) = ma {
        b[i] -= i_eq;
    }
    if let Some(j) = mk {
        b[j] += i_eq;
    }

    Ok(())
}

/// 读取节点工作点电压（地节点固定为 0）
fn get_guess(
    node_idx: usize,
    ctx: &CircuitContext,
    v_guess: &HashMap<usize, f64>,
) -> f64 {
    if node_idx == ctx.ground_index {
        0.0
    } else {
        v_guess.get(&node_idx).copied().unwrap_or(0.0)
    }
}

// ============================================================
// 辅助函数
// ============================================================

fn get_pin_node(
    comp: &SolverComponent,
    pin_id: &str,
    ctx: &CircuitContext,
) -> Result<usize, SolverError> {
    let key = format!("{}:{}", comp.id, pin_id);
    ctx.node_index.get(&key).copied().ok_or_else(|| SolverError::MissingPin {
        component_id: comp.id,
        pin_id: pin_id.to_string(),
    })
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
