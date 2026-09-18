// src-tauri/src/solver/context.rs

use std::collections::HashMap;

/// 求解过程中的共享上下文
#[derive(Debug, Default)]
pub struct CircuitContext {
    /// 节点名称（格式 "componentId:pinId"）→ 索引
    pub node_index: HashMap<String, usize>,
    /// 节点总数
    pub node_count: usize,
    /// 地节点索引（默认 0）
    pub ground_index: usize,
}

impl CircuitContext {
    pub fn new() -> Self {
        Self {
            node_index: HashMap::new(),
            node_count: 0,
            ground_index: 0,
        }
    }
}
