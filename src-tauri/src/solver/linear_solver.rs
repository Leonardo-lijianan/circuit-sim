// src-tauri/src/solver/linear_solver.rs

use super::output::SolverError;
use nalgebra::{DMatrix, DVector};

/// 求解线性方程组 A · x = b
/// 
/// 用 LU 分解。奇异矩阵返回 SingularMatrix 错误。
pub fn solve_linear(a: &DMatrix<f64>, b: &DVector<f64>) -> Result<DVector<f64>, SolverError> {
    if a.nrows() != a.ncols() {
        return Err(SolverError::SingularMatrix);
    }
    if a.nrows() != b.len() {
        return Err(SolverError::SingularMatrix);
    }

    a.clone()
        .lu()
        .solve(b)
        .ok_or(SolverError::SingularMatrix)
}
