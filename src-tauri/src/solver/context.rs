// src-tauri/src/solver/context.rs

use std::collections::{HashMap, HashSet};

/// 求解过程中的共享上下文
#[derive(Debug, Default)]
pub struct CircuitContext {
    /// 节点名称（格式 "componentId:pinId"）→ 索引
    pub node_index: HashMap<String, usize>,
    /// 节点总数
    pub node_count: usize,
    /// 地节点索引集合（每个连通分量各自的地）
    pub ground_indices: HashSet<usize>,
}

impl CircuitContext {
    pub fn new() -> Self {
        Self {
            node_index: HashMap::new(),
            node_count: 0,
            ground_indices: HashSet::new(),
        }
    }

    /// 判断某节点是否为地
    pub fn is_ground(&self, node_idx: usize) -> bool {
        self.ground_indices.contains(&node_idx)
    }
}
