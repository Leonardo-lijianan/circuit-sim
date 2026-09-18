// src-tauri/src/solver/graph_builder.rs

use super::context::CircuitContext;
use super::input::SolverInput;
use super::output::SolverError;
use std::collections::{HashMap, HashSet};

/// 引脚全名："componentId:pinId"
fn pin_key(component_id: u32, pin_id: &str) -> String {
    format!("{}:{}", component_id, pin_id)
}

struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self { parent: (0..n).collect() }
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

pub fn build_graph(input: &SolverInput) -> Result<CircuitContext, SolverError> {
    if input.components.is_empty() {
        return Err(SolverError::EmptyCircuit);
    }

    // 1. 收集所有引脚
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

    // 2. 两套并查集
    //    - node_uf: 只合并导线（用于节点编号，元件的两个引脚是不同节点）
    //    - conn_uf: 导线 + 元件内部（用于连通分量检测）
    let mut node_uf = UnionFind::new(temp_to_pin.len());
    let mut conn_uf = UnionFind::new(temp_to_pin.len());

    for wire in &input.wires {
        let start_key = pin_key(wire.start.component_id, &wire.start.pin_id);
        let end_key = pin_key(wire.end.component_id, &wire.end.pin_id);
        if let (Some(&a), Some(&b)) = (pin_to_temp.get(&start_key), pin_to_temp.get(&end_key)) {
            node_uf.union(a, b);
            conn_uf.union(a, b);
        }
    }

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

    // 3. 节点编号（用 node_uf）
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

    // 4. 预先算每个 temp 的 conn 分量 root
    let mut temp_conn_root: Vec<usize> = Vec::with_capacity(temp_to_pin.len());
    for i in 0..temp_to_pin.len() {
        temp_conn_root.push(conn_uf.find(i));
    }

    // 5. 每个连通分量各自确定一个地节点
    //    优先 GND 元件，否则取第一个电压源的 neg 引脚
    let mut root_ground: HashMap<usize, usize> = HashMap::new();

    // 5a. GND 元件
    for comp in &input.components {
        if comp.func != "ground" { continue; }
        if let Some(pin) = comp.pins.first() {
            let key = pin_key(comp.id, &pin.id);
            if let Some(&temp_idx) = pin_to_temp.get(&key) {
                let root = temp_conn_root[temp_idx];
                root_ground.entry(root).or_insert(temp_to_node[temp_idx]);
            }
        }
    }

    // 5b. 电压源的 neg 引脚
    for comp in &input.components {
        if comp.func != "voltage_source" { continue; }
        let neg_pin = comp.pins.iter().find(|p| p.id == "neg")
            .or_else(|| comp.pins.first());
        if let Some(pin) = neg_pin {
            let key = pin_key(comp.id, &pin.id);
            if let Some(&temp_idx) = pin_to_temp.get(&key) {
                let root = temp_conn_root[temp_idx];
                root_ground.entry(root).or_insert(temp_to_node[temp_idx]);
            }
        }
    }

    // 6. 完全没有地 → NoGround
    if root_ground.is_empty() {
        return Err(SolverError::NoGround);
    }

    // 7. 浮地检测：找出所有没有地的分量
    let mut all_roots: HashSet<usize> = HashSet::new();
    for &root in &temp_conn_root {
        all_roots.insert(root);
    }

    let mut floating_nodes: Vec<usize> = Vec::new();
    for root in &all_roots {
        if !root_ground.contains_key(root) {
            for i in 0..temp_to_pin.len() {
                if temp_conn_root[i] == *root {
                    floating_nodes.push(temp_to_node[i]);
                }
            }
        }
    }

    if !floating_nodes.is_empty() {
        floating_nodes.sort_unstable();
        floating_nodes.dedup();
        return Err(SolverError::FloatingSubcircuit(floating_nodes));
    }

    // 8. 构建 node_index 和 ground_indices
    let mut node_index: HashMap<String, usize> = HashMap::new();
    for (i, key) in temp_to_pin.iter().enumerate() {
        node_index.insert(key.clone(), temp_to_node[i]);
    }

    let ground_indices: HashSet<usize> = root_ground.values().copied().collect();

    Ok(CircuitContext {
        node_index,
        node_count,
        ground_indices,
    })
}
