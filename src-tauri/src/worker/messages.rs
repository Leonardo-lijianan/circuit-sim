// src-tauri/src/worker/messages.rs

use crate::solver::{SolverInput, SolverOutput};
use serde::Serialize;

/// 前端发给 Worker 的控制指令
pub enum SolverCommand {
    Start,
    Pause,
    Stop,
    UpdateInput(SolverInput),
    Shutdown,
}

/// Worker 推给前端的消息（内部标签 type，便于前端区分）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum WorkerMessage {
    Output { batch: Vec<SolverOutput> },
    Error { message: String },
    StateChanged { state: String },
}
