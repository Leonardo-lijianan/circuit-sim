// src-tauri/src/solver/nonlinear.rs

use super::context::CircuitContext;
use super::input::SolverInput;
use super::linear_solver::solve_linear;
use super::matrix_builder::{build_mna, MnaSystem};
use super::output::SolverError;
use nalgebra::DVector;
use std::collections::HashMap;

const MAX_ITER: usize = 100;
const TOL: f64 = 1e-6;

/// 判断电路是否含非线性元件
pub fn has_nonlinear(input: &SolverInput) -> bool {
    input.components.iter().any(|c| c.func == "diode")
}

/// 牛顿-拉夫逊迭代求解非线性电路
/// 
/// 返回 (解向量, 最后一次迭代的 MNA 系统)
pub fn solve_newton(
    input: &SolverInput,
    ctx: &CircuitContext,
) -> Result<(DVector<f64>, MnaSystem), SolverError> {
    let mut v_guess: HashMap<usize, f64> = HashMap::new();
    let mut last_x: Option<DVector<f64>> = None;

    for _iter in 0..MAX_ITER {
        let mna = build_mna(input, ctx, &v_guess)?;
        let x = solve_linear(&mna.a, &mna.b)?;

        // 收敛检查
        if let Some(prev) = &last_x {
            let delta: DVector<f64> = &x - prev;
            if delta.norm() < TOL {
                return Ok((x, mna));
            }
        }

        // 用当前解更新工作点
        v_guess.clear();
        for (node_idx, mat_idx) in &mna.node_matrix_index {
            v_guess.insert(*node_idx, x[*mat_idx]);
        }

        last_x = Some(x);
    }

    Err(SolverError::NonConvergent(MAX_ITER))
}
