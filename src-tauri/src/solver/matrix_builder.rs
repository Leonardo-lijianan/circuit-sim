// src-tauri/src/solver/matrix_builder.rs

use super::context::CircuitContext;
use super::input::{SolverComponent, SolverInput};
use super::models;
use super::output::SolverError;
use nalgebra::{DMatrix, DVector};
use std::collections::HashMap;

/// MNA 系统（矩阵 + 元数据）
///
/// 未知量 x 排列：
///   x[0..n_nodes]              : 非地节点电压
///   x[n_nodes..n_nodes+n_vs]   : 电压源电流（按 voltage_source_ids 顺序）
pub struct MnaSystem {
    pub a: DMatrix<f64>,
    pub b: DVector<f64>,
    /// node_index（来自 CircuitContext）→ 矩阵行列索引（0-based，跳过地节点）
    pub node_matrix_index: HashMap<usize, usize>,
    /// 电压源元件 id，按 x 中的出现顺序
    pub voltage_source_ids: Vec<u32>,
    /// 非地节点数
    pub n_nodes: usize,
}

/// 构建 MNA 方程组
///
/// v_guess: 非线性元件线性化用的工作点电压（node_index → 电压）；线性电路传空 HashMap
pub fn build_mna(
    input: &SolverInput,
    ctx: &CircuitContext,
    v_guess: &HashMap<usize, f64>,
) -> Result<MnaSystem, SolverError> {
    // 1. 节点重映射（跳过所有地节点）
    let mut node_matrix_index: HashMap<usize, usize> = HashMap::new();
    let mut next_idx = 0;
    for i in 0..ctx.node_count {
        if ctx.is_ground(i) {
            continue;
        }
        node_matrix_index.insert(i, next_idx);
        next_idx += 1;
    }
    let n_nodes = next_idx;

    // 2. 收集电压源 id（保持输入顺序）
    let mut voltage_source_ids: Vec<u32> = Vec::new();
    for comp in &input.components {
        if comp.func == "voltage_source" {
            voltage_source_ids.push(comp.id);
        }
    }
    let n_vs = voltage_source_ids.len();

    // 3. 矩阵尺寸
    let size = n_nodes + n_vs;
    let mut a = DMatrix::<f64>::zeros(size, size);
    let mut b = DVector::<f64>::zeros(size);

    // 4. 逐个元件填充
    let mut vs_counter = 0;
    for comp in &input.components {
        match comp.func.as_str() {
            "ohm" => fill_ohm(comp, ctx, &node_matrix_index, &mut a),
            "voltage_source" => {
                let k = n_nodes + vs_counter;
                vs_counter += 1;
                fill_voltage_source(comp, ctx, &node_matrix_index, k, &mut a, &mut b)
            }
            "current_source" => fill_current_source(comp, ctx, &node_matrix_index, &mut b),
            "diode" => fill_diode(comp, ctx, &node_matrix_index, v_guess, &mut a, &mut b),
            "switch" => fill_switch(comp, ctx, &node_matrix_index, &mut a),
            "ground" => Ok(()), // GND 只作为节点标记，不产生方程
            _ => Err(SolverError::UnknownSolver(comp.func.clone())),
        }?;
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
// 电阻
// ============================================================

fn fill_ohm(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    a: &mut DMatrix<f64>,
) -> Result<(), SolverError> {
    let r = models::read_ohm_r(comp);
    if r <= 0.0 {
        return Err(SolverError::SingularMatrix);
    }
    let g = 1.0 / r;

    let (ma, mb) = two_pin_matrix_indices(comp, ctx, n2m)?;
    stamp_conductance(a, ma, mb, g);
    Ok(())
}

// ============================================================
// 电压源
// ============================================================

fn fill_voltage_source(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    k: usize,
    a: &mut DMatrix<f64>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    let v = models::read_vsource_v(comp)?;

    let node_pos = get_pin_node(comp, "pos", ctx)?;
    let node_neg = get_pin_node(comp, "neg", ctx)?;
    let mp = n2m.get(&node_pos).copied();
    let mn = n2m.get(&node_neg).copied();

    // 约束行：V_pos - V_neg = V
    match (mp, mn) {
        (Some(i), Some(j)) => {
            a[(k, i)] += 1.0;
            a[(k, j)] -= 1.0;
        }
        (Some(i), None) => { a[(k, i)] += 1.0; }
        (None, Some(j)) => { a[(k, j)] -= 1.0; }
        (None, None) => return Err(SolverError::SingularMatrix),
    }
    b[k] = v;

    // KCL 第 k 列
    if let Some(i) = mp { a[(i, k)] += 1.0; }
    if let Some(j) = mn { a[(j, k)] -= 1.0; }

    Ok(())
}

// ============================================================
// 电流源
// ============================================================

fn fill_current_source(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    let current = models::read_isource_i(comp)?;

    let (ma, mb) = two_pin_matrix_indices(comp, ctx, n2m)?;

    // 电流从 pins[0] 流出到节点 a（流入节点 a）→ b[a] += I
    // 从节点 b 流入 pins[1]（流出节点 b）→ b[b] -= I
    if let Some(i) = ma { b[i] += current; }
    if let Some(j) = mb { b[j] -= current; }

    Ok(())
}

// ============================================================
// 二极管（分段线性模型）
// ============================================================
//
// 模型：
//   V = V_a - V_k
//   if V < Vf:  I ≈ Gmin · V          （关断）
//   if V ≥ Vf:  I = (V - Vf) / Ron    （导通）
//
// MNA 填充：
//   导通：G = 1/Ron，等效电流源 I_eq = Vf/Ron
//   关断：G = Gmin，无等效电流源

fn fill_diode(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    v_guess: &HashMap<usize, f64>,
    a: &mut DMatrix<f64>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    let p = models::read_diode_params(comp);

    let node_a = get_pin_node(comp, "a", ctx)?;
    let node_k = get_pin_node(comp, "k", ctx)?;

    let v_a = get_guess(node_a, ctx, v_guess);
    let v_k = get_guess(node_k, ctx, v_guess);
    let v = v_a - v_k;

    let ma = n2m.get(&node_a).copied();
    let mk = n2m.get(&node_k).copied();

    if v < p.vf {
        // 关断：极小电导
        stamp_conductance(a, ma, mk, models::DIODE_GMIN);
    } else {
        // 导通：I = (V_a - V_k - Vf) / Ron
        // 改写成 MNA 形式：(1/Ron)·V_a - (1/Ron)·V_k = Vf/Ron
        let g = 1.0 / p.ron;
        let i_eq = p.vf / p.ron;  // 等效电流源，从 b 向量加常数项
        stamp_conductance(a, ma, mk, g);
        if let Some(i) = ma { b[i] += i_eq; }
        if let Some(j) = mk { b[j] -= i_eq; }
    }

    Ok(())
}

// ============================================================
// 开关
// ============================================================
//
// 参数：closed（bool）、Ron、Roff
//   closed=true:  G = 1/Ron
//   closed=false: G = 1/Roff

fn fill_switch(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    a: &mut DMatrix<f64>,
) -> Result<(), SolverError> {
    let p = models::read_switch_params(comp);
    let r = if p.closed { p.ron } else { p.roff };
    if r <= 0.0 {
        return Err(SolverError::SingularMatrix);
    }
    let g = 1.0 / r;

    let (ma, mb) = two_pin_matrix_indices(comp, ctx, n2m)?;
    stamp_conductance(a, ma, mb, g);
    Ok(())
}

// ============================================================
// 通用工具
// ============================================================

/// 把 "从 pins[0] 流入，从 pins[1] 流出" 的电流模型
/// 填充到 MNA 电导矩阵中
fn stamp_conductance(
    a: &mut DMatrix<f64>,
    ma: Option<usize>,
    mb: Option<usize>,
    g: f64,
) {
    match (ma, mb) {
        (Some(i), Some(j)) => {
            a[(i, i)] += g;
            a[(j, j)] += g;
            a[(i, j)] -= g;
            a[(j, i)] -= g;
        }
        (Some(i), None) => { a[(i, i)] += g; }
        (None, Some(j)) => { a[(j, j)] += g; }
        (None, None) => {}
    }
}

/// 获取元件的两个引脚（按 pins 数组顺序）对应的矩阵索引
fn two_pin_matrix_indices(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
) -> Result<(Option<usize>, Option<usize>), SolverError> {
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

    Ok((
        n2m.get(&node_a).copied(),
        n2m.get(&node_b).copied(),
    ))
}

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

fn get_guess(
    node_idx: usize,
    ctx: &CircuitContext,
    v_guess: &HashMap<usize, f64>,
) -> f64 {
    if ctx.is_ground(node_idx) {
        0.0
    } else {
        v_guess.get(&node_idx).copied().unwrap_or(0.0)
    }
}
