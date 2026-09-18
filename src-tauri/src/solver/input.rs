// src-tauri/src/solver/input.rs

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// 求解输入（与前端 SolverInput 对齐）
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverInput {
    pub analysis: AnalysisConfig,
    pub components: Vec<SolverComponent>,
    pub wires: Vec<SolverWire>,
}

/// 分析配置
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisConfig {
    /// "dc" | "ac" | "transient"
    #[serde(rename = "type")]
    pub analysis_type: String,
    pub time_step: Option<f64>,
    pub final_time: Option<f64>,
    pub freq: Option<f64>,
}

/// 元件描述
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverComponent {
    pub id: u32,
    pub func: String,
    pub params: HashMap<String, Value>,
    pub pins: Vec<PinRef>,
}

/// 引脚引用
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRef {
    pub id: String,
}

/// 连线描述
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverWire {
    pub start: WireEnd,
    pub end: WireEnd,
}

/// 连线端点
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireEnd {
    pub component_id: u32,
    pub pin_id: String,
}

// ============================================================
// 单元测试：serde 反序列化对齐
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_simple_input() {
        let json = r#"{
            "analysis": { "type": "dc" },
            "components": [
                {
                    "id": 1,
                    "func": "ohm",
                    "params": { "R": 1000 },
                    "pins": [{ "id": "p1" }, { "id": "p2" }]
                }
            ],
            "wires": []
        }"#;
        let input: SolverInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.components.len(), 1);
        assert_eq!(input.components[0].func, "ohm");
        assert_eq!(input.analysis.analysis_type, "dc");
        assert_eq!(input.components[0].pins.len(), 2);
        assert_eq!(input.components[0].pins[0].id, "p1");
    }

    #[test]
    fn test_deserialize_wire() {
        let json = r#"{
            "analysis": { "type": "dc" },
            "components": [],
            "wires": [
                {
                    "start": { "componentId": 1, "pinId": "k" },
                    "end": { "componentId": 2, "pinId": "p1" }
                }
            ]
        }"#;
        let input: SolverInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.wires.len(), 1);
        assert_eq!(input.wires[0].start.component_id, 1);
        assert_eq!(input.wires[0].start.pin_id, "k");
    }

    #[test]
    fn test_params_mixed_types() {
        let json = r#"{
            "analysis": { "type": "dc" },
            "components": [
                {
                    "id": 1,
                    "func": "switch",
                    "params": { "closed": true, "resistance": 0.01 },
                    "pins": [{ "id": "a" }, { "id": "b" }]
                }
            ],
            "wires": []
        }"#;
        let input: SolverInput = serde_json::from_str(json).unwrap();
        let params = &input.components[0].params;
        assert_eq!(params.get("closed").unwrap().as_bool(), Some(true));
        assert_eq!(params.get("resistance").unwrap().as_f64(), Some(0.01));
    }
}
