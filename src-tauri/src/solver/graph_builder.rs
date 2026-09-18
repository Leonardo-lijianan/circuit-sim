// src-tauri/src/solver/graph_builder.rs

use super::context::CircuitContext;
use super::input::SolverInput;
use super::output::SolverError;
use std::collections::HashMap;

/// 引脚全名："componentId:pinId"
fn pin_key(component_id: u32, pin_id: &str) -> String {
    format!("{}:{}", component_id, pin_id)
}

/// 并查集
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
        }
    }

    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }

    fn union(&mut self, a: usize, b: usize) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent[ra] = rb;
        }
    }
}

/// 从输入构建图，返回节点映射上下文
pub fn build_graph(input: &SolverInput) -> Result<CircuitContext, SolverError> {
    if input.components.is_empty() {
        return Err(SolverError::EmptyCircuit);
    }

    // 1. 收集所有引脚的临时索引
    // pin_key → temp_index
    let mut pin_to_temp: HashMap<String, usize> = HashMap::new();
    let mut temp_to_pin: Vec<String> = Vec::new();

    for comp in &input.components {
        for pin in &comp.pins {
            let key = pin_key(comp.id, &pin.id);
            if !pin_to_temp.contains_key(&key) {
                pin_to_temp.insert(key.clone(), temp_to_pin.len());
                temp_to_pin.push(key);
            }
        }
    }

    // 2. 两套并查集：
    //    - node_uf: 只合并导线 → 用于节点编号（元件两引脚是不同节点）
    //    - conn_uf: 合并导线 + 元件内部引脚 → 用于浮地检测
    let mut node_uf = UnionFind::new(temp_to_pin.len());
    let mut conn_uf = UnionFind::new(temp_to_pin.len());

    // 2a. 用导线合并（两套都合并）
    for wire in &input.wires {
        let start_key = pin_key(wire.start.component_id, &wire.start.pin_id);
        let end_key = pin_key(wire.end.component_id, &wire.end.pin_id);

        let start_idx = pin_to_temp.get(&start_key).copied();
        let end_idx = pin_to_temp.get(&end_key).copied();

        if let (Some(a), Some(b)) = (start_idx, end_idx) {
            node_uf.union(a, b);
            conn_uf.union(a, b);
        }
    }

    // 2b. 用元件内部引脚合并（仅 conn_uf）
    //     元件的两个引脚在电气上通过元件相连（有电流可流过）
    for comp in &input.components {
        let mut first: Option<usize> = None;
        for pin in &comp.pins {
            let key = pin_key(comp.id, &pin.id);
            if let Some(&idx) = pin_to_temp.get(&key) {
                match first {
                    None => first = Some(idx),
                    Some(f) => conn_uf.union(f, idx),
                }
            }
        }
    }

    // 3. 每个连通分量分配一个节点索引
    // root_temp → node_index
    let mut root_to_node: HashMap<usize, usize> = HashMap::new();
    let mut temp_to_node: Vec<usize> = vec![0; temp_to_pin.len()];

    for i in 0..temp_to_pin.len() {
        let root = node_uf.find(i);
        let node_idx = match root_to_node.get(&root) {
            Some(&n) => n,
            None => {
                let n = root_to_node.len();
                root_to_node.insert(root, n);
                n
            }
        };
        temp_to_node[i] = node_idx;
    }

    let node_count = root_to_node.len();

    // 4. 确定地节点
    // 优先 GND 元件 → 否则第一个电压源的 neg 引脚 → 否则报错
    let mut ground_node: Option<usize> = None;

    // 4a. 优先找 GND 元件
    for comp in &input.components {
        if comp.func == "ground" {
            if let Some(pin) = comp.pins.first() {
                let key = pin_key(comp.id, &pin.id);
                if let Some(&temp_idx) = pin_to_temp.get(&key) {
                    ground_node = Some(temp_to_node[temp_idx]);
                    break;
                }
            }
        }
    }

    // 4b. 没有 GND，用第一个电压源的 neg 引脚
    if ground_node.is_none() {
        for comp in &input.components {
            if comp.func == "voltage_source" {
                // 优先找 id == "neg" 的引脚
                let neg_pin = comp.pins.iter().find(|p| p.id == "neg")
                    .or_else(|| comp.pins.first());
                if let Some(pin) = neg_pin {
                    let key = pin_key(comp.id, &pin.id);
                    if let Some(&temp_idx) = pin_to_temp.get(&key) {
                        ground_node = Some(temp_to_node[temp_idx]);
                        break;
                    }
                }
            }
        }
    }

    let ground_node = ground_node.ok_or(SolverError::NoGround)?;

    // 5. 浮地检测（用 conn_uf：导线 + 元件内部连接）
    // 找到 ground_node 对应的第一个 temp_index，取其 conn 分量的 root
    let ground_temp = temp_to_node.iter().position(|&n| n == ground_node)
        .ok_or(SolverError::NoGround)?;
    let ground_root = conn_uf.find(ground_temp);

    let mut floating_nodes: Vec<usize> = Vec::new();
    let mut seen_roots: Vec<usize> = Vec::new();
    for i in 0..temp_to_pin.len() {
        let root = conn_uf.find(i);
        if root != ground_root && !seen_roots.contains(&root) {
            seen_roots.push(root);
            floating_nodes.push(temp_to_node[i]);
        }
    }

    if !floating_nodes.is_empty() {
        floating_nodes.sort_unstable();
        floating_nodes.dedup();
        return Err(SolverError::FloatingSubcircuit(floating_nodes));
    }

    // 6. 构建最终 node_index（pin_key → node_index）
    let mut node_index: HashMap<String, usize> = HashMap::new();
    for (i, key) in temp_to_pin.iter().enumerate() {
        node_index.insert(key.clone(), temp_to_node[i]);
    }

    Ok(CircuitContext {
        node_index,
        node_count,
        ground_index: ground_node,
    })
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::input::*;
    use std::collections::HashMap;

    fn make_component(id: u32, func: &str, pin_ids: &[&str]) -> SolverComponent {
        SolverComponent {
            id,
            func: func.to_string(),
            params: HashMap::new(),
            pins: pin_ids.iter().map(|pid| PinRef { id: pid.to_string() }).collect(),
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

    fn make_wire(c1: u32, p1: &str, c2: u32, p2: &str) -> SolverWire {
        SolverWire {
            start: WireEnd { component_id: c1, pin_id: p1.to_string() },
            end: WireEnd { component_id: c2, pin_id: p2.to_string() },
        }
    }

    #[test]
    fn test_empty_circuit() {
        let input = make_input(vec![], vec![]);
        assert!(matches!(build_graph(&input), Err(SolverError::EmptyCircuit)));
    }

    #[test]
    fn test_no_ground_error() {
        // 只有一个电阻，没有 GND 也没有电压源
        let input = make_input(
            vec![make_component(1, "ohm", &["p1", "p2"])],
            vec![],
        );
        assert!(matches!(build_graph(&input), Err(SolverError::NoGround)));
    }

    #[test]
    fn test_gnd_component() {
        // GND + 电阻，GND 引脚连到电阻 p1
        let input = make_input(
            vec![
                make_component(1, "ground", &["gnd"]),
                make_component(2, "ohm", &["p1", "p2"]),
            ],
            vec![
                make_wire(1, "gnd", 2, "p1"),
            ],
        );
        let ctx = build_graph(&input).unwrap();
        // 节点：gnd+p1 合并 = 1 个；p2 = 1 个。共 2 个
        assert_eq!(ctx.node_count, 2);
        // 地节点应该是那个 gnd+p1 合并出来的节点
        let gnd_key = "1:gnd".to_string();
        assert_eq!(ctx.node_index.get(&gnd_key), Some(&ctx.ground_index));
    }

    #[test]
    fn test_battery_neg_as_default_ground() {
        // 电池 + 电阻，闭合回路，无 GND
        // pos -- p1， neg -- p2
        let input = make_input(
            vec![
                make_component(1, "voltage_source", &["neg", "pos"]),
                make_component(2, "ohm", &["p1", "p2"]),
            ],
            vec![
                make_wire(1, "pos", 2, "p1"),
                make_wire(1, "neg", 2, "p2"),
            ],
        );
        let ctx = build_graph(&input).unwrap();
        // 节点：neg+p2（地）、pos+p1。共 2 个
        assert_eq!(ctx.node_count, 2);
        // 地节点应该是 neg 所在的节点
        let neg_key = "1:neg".to_string();
        assert_eq!(ctx.node_index.get(&neg_key), Some(&ctx.ground_index));
    }

    #[test]
    fn test_floating_subcircuit() {
        // 两个独立电路：一个是电池+电阻，另一个是孤立电阻
        // 应该报浮地
        let input = make_input(
            vec![
                make_component(1, "voltage_source", &["neg", "pos"]),
                make_component(2, "ohm", &["p1", "p2"]),
                make_component(3, "ohm", &["p1", "p2"]),  // 孤立
            ],
            vec![
                make_wire(1, "pos", 2, "p1"),
            ],
        );
        let result = build_graph(&input);
        assert!(matches!(result, Err(SolverError::FloatingSubcircuit(_))));
    }
}
