// src-tauri/src/solver/core.rs

use super::graph_builder::build_graph;
use super::input::SolverInput;
use super::linear_solver::solve_linear;
use super::matrix_builder::build_mna;
use super::nonlinear::{has_nonlinear, solve_newton};
use super::output::{SolverError, SolverOutput};
use super::result_extractor::extract_results;
use std::collections::HashMap;

/// 求解电路主流程
///
/// 1. 构建图（节点编号 + 浮地检测）
/// 2. 判断是否含非线性元件
///    - 是：牛顿迭代
///    - 否：直接线性求解
/// 3. 提取每个元件的结果
pub fn solve(input: &SolverInput) -> Result<Vec<SolverOutput>, SolverError> {
    let ctx = build_graph(input)?;

    let (x, mna) = if has_nonlinear(input) {
        solve_newton(input, &ctx)?
    } else {
        let empty = HashMap::new();
        let mna = build_mna(input, &ctx, &empty)?;
        let x = solve_linear(&mna.a, &mna.b)?;
        (x, mna)
    };

    let outputs = extract_results(input, &ctx, &mna, &x)?;
    Ok(outputs)
}

// ============================================================
// 集成测试：验证完整求解流程
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::input::*;
    use std::collections::HashMap;

    fn make_component(
        id: u32,
        func: &str,
        pin_ids: &[&str],
        params: &[(&str, f64)],
    ) -> SolverComponent {
        let mut p: HashMap<String, serde_json::Value> = HashMap::new();
        for (k, v) in params {
            p.insert(k.to_string(), serde_json::json!(v));
        }
        SolverComponent {
            id,
            func: func.to_string(),
            params: p,
            pins: pin_ids
                .iter()
                .map(|pid| PinRef { id: pid.to_string() })
                .collect(),
        }
    }

    fn make_wire(c1: u32, p1: &str, c2: u32, p2: &str) -> SolverWire {
        SolverWire {
            start: WireEnd { component_id: c1, pin_id: p1.to_string() },
            end: WireEnd { component_id: c2, pin_id: p2.to_string() },
        }
    }

    fn make_input(components: Vec<SolverComponent>, wires: Vec<SolverWire>) -> SolverInput {
        SolverInput {
            analysis: AnalysisConfig {
                analysis_type: "dc".to_string(),
                time_step: None,
                final_time: None,
                freq: None,
            },
            components,
            wires,
        }
    }

    /// 场景1：1.5V 电池 + 1000Ω 电阻，闭合回路
    /// 预期：V_R = 1.5V, I_R = 0.0015A, P_R = 0.00225W（吸收）
    ///       V_bat = 1.5V, I_bat = -0.0015A, P_bat = -0.00225W（发出）
    #[test]
    fn test_battery_resistor() {
        let input = make_input(
            vec![
                make_component(1, "voltage_source", &["neg", "pos"], &[("V", 1.5)]),
                make_component(2, "ohm", &["p1", "p2"], &[("R", 1000.0)]),
            ],
            vec![
                make_wire(1, "pos", 2, "p1"),
                make_wire(1, "neg", 2, "p2"),
            ],
        );
        let results = solve(&input).unwrap();
        assert_eq!(results.len(), 2);

        // 电池
        let bat = results.iter().find(|r| r.component_id == 1).unwrap();
        assert!((bat.voltage - 1.5).abs() < 1e-9, "bat V = {}", bat.voltage);
        assert!((bat.current - (-0.0015)).abs() < 1e-9, "bat I = {}", bat.current);
        assert!(bat.power < 0.0, "bat 应该发出功率");

        // 电阻
        let res = results.iter().find(|r| r.component_id == 2).unwrap();
        assert!((res.voltage - 1.5).abs() < 1e-9, "res V = {}", res.voltage);
        assert!((res.current - 0.0015).abs() < 1e-9, "res I = {}", res.current);
        assert!((res.power - 0.00225).abs() < 1e-9, "res P = {}", res.power);
    }

    /// 场景2：1.5V 电池 + 两个 1000Ω 电阻串联
    /// 预期：每个电阻 V = 0.75V, I = 0.00075A
    #[test]
    fn test_voltage_divider() {
        // 电池 pos — R1.p1，R1.p2 — R2.p1，R2.p2 — 电池 neg
        let input = make_input(
            vec![
                make_component(1, "voltage_source", &["neg", "pos"], &[("V", 1.5)]),
                make_component(2, "ohm", &["p1", "p2"], &[("R", 1000.0)]),
                make_component(3, "ohm", &["p1", "p2"], &[("R", 1000.0)]),
            ],
            vec![
                make_wire(1, "pos", 2, "p1"),
                make_wire(2, "p2", 3, "p1"),
                make_wire(3, "p2", 1, "neg"),
            ],
        );
        let results = solve(&input).unwrap();

        let r1 = results.iter().find(|r| r.component_id == 2).unwrap();
        let r2 = results.iter().find(|r| r.component_id == 3).unwrap();

        assert!((r1.voltage - 0.75).abs() < 1e-9, "R1 V = {}", r1.voltage);
        assert!((r1.current - 0.00075).abs() < 1e-9, "R1 I = {}", r1.current);
        assert!((r2.voltage - 0.75).abs() < 1e-9, "R2 V = {}", r2.voltage);
        assert!((r2.current - 0.00075).abs() < 1e-9, "R2 I = {}", r2.current);
    }

    /// 场景3：电流源 1mA 驱动 1000Ω 电阻
    /// 预期：V_R = 1V, I_R = 0.001A
    /// 注意：电路需要 GND 才能求解
    #[test]
    fn test_current_source() {
        // GND — R.p1，R.p2 — 电流源.pins[1]，电流源.pins[0] — GND
        // 电流源从 pins[0] 流出，所以从 GND 流出 → 流入 GND
        // 等等，方向反了。重新设计：
        // 电流源从 pins[0] 流出 → 流入 R.p1；R.p2 连回 GND；电流源 pins[1] 接 GND
        let input = make_input(
            vec![
                make_component(1, "ground", &["gnd"], &[]),
                make_component(2, "current_source", &["p1", "p2"], &[("I", 0.001)]),
                make_component(3, "ohm", &["p1", "p2"], &[("R", 1000.0)]),
            ],
            vec![
                // 电流源 p2 接地
                make_wire(2, "p2", 1, "gnd"),
                // 电流源 p1 接 R.p1
                make_wire(2, "p1", 3, "p1"),
                // R.p2 接地
                make_wire(3, "p2", 1, "gnd"),
            ],
        );
        let results = solve(&input).unwrap();

        let res = results.iter().find(|r| r.component_id == 3).unwrap();
        // 电流源从 p1 流出 1mA，流入 R.p1
        // R 关联方向：p1 流入，p2 流出 → 电流为正
        assert!((res.current - 0.001).abs() < 1e-9, "R I = {}", res.current);
        assert!((res.voltage - 1.0).abs() < 1e-9, "R V = {}", res.voltage);
    }

    /// 场景4：5V 电池 + 1000Ω + LED，LED 正向导通
    /// 预期：LED 正向压降约 0.6~0.8V，电流约 4~5mA
    #[test]
    fn test_led_with_resistor() {
        let input = make_input(
            vec![
                make_component(1, "voltage_source", &["neg", "pos"], &[("V", 5.0)]),
                make_component(2, "ohm", &["p1", "p2"], &[("R", 1000.0)]),
                make_component(3, "diode", &["a", "k"], &[]),
            ],
            vec![
                make_wire(1, "pos", 2, "p1"),
                make_wire(2, "p2", 3, "a"),
                make_wire(3, "k", 1, "neg"),
            ],
        );
        let results = solve(&input).unwrap();

        let led = results.iter().find(|r| r.component_id == 3).unwrap();
        // 二极管正向压降应该在 0.5~0.8V 之间
        assert!(led.voltage > 0.5 && led.voltage < 0.8, "LED V = {}", led.voltage);
        // 电流应该在 4~5mA 之间
        assert!(led.current > 0.003 && led.current < 0.005, "LED I = {}", led.current);
        // LED 吸收功率
        assert!(led.power > 0.0);
    }
}
