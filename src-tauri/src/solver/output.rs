// src-tauri/src/solver/output.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 求解输出
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverOutput {
    pub component_id: u32,
    pub voltage: f64,
    pub current: f64,
    pub power: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_voltages: Option<HashMap<String, f64>>,
}

/// 求解错误
#[derive(Debug, thiserror::Error)]
pub enum SolverError {
    #[error("浮地子电路：节点 {0:?} 没有接地")]
    FloatingSubcircuit(Vec<usize>),

    #[error("矩阵奇异，无法求解")]
    SingularMatrix,

    #[error("未知求解器函数: {0}")]
    UnknownSolver(String),

    #[error("牛顿迭代不收敛（迭代 {0} 次）")]
    NonConvergent(usize),

    #[error("元件 {component_id} 缺少参数 {param}")]
    MissingParam { component_id: u32, param: String },

    #[error("电路为空")]
    EmptyCircuit,

    #[error("电路中没有参考地（无 GND 元件，也无电压源）")]
    NoGround,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_output() {
        let output = SolverOutput {
            component_id: 1,
            voltage: 1.8,
            current: 0.02,
            power: 0.036,
            node_voltages: None,
        };
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("\"componentId\":1"));
        assert!(json.contains("\"voltage\":1.8"));
        assert!(!json.contains("nodeVoltages"));
    }

    #[test]
    fn test_error_display() {
        let err = SolverError::UnknownSolver("foobar".to_string());
        assert_eq!(err.to_string(), "未知求解器函数: foobar");
    }
}
