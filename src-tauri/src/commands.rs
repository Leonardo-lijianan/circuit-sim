// src-tauri/src/commands.rs

use crate::solver::{solve, SolverInput, SolverOutput};

/// 一次性求解（同步，无 Worker）
/// 
/// 用于 Phase 5 早期测试，以及简单的参数改了立即算场景。
/// Worker 常驻流式推送在后续 Task 5.2 中实现。
#[tauri::command]
pub fn solve_circuit(input: SolverInput) -> Result<Vec<SolverOutput>, String> {
    solve(&input).map_err(|e| e.to_string())
}
