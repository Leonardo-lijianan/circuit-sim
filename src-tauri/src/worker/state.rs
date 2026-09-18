// src-tauri/src/worker/state.rs

use super::messages::{SolverCommand, WorkerMessage};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::sync::mpsc::UnboundedSender;

/// Worker 句柄（通过 tauri::State 共享给命令）
pub struct WorkerHandle {
    /// 向前端发指令的通道
    pub cmd_tx: UnboundedSender<SolverCommand>,
    /// 向前端推结果的 Channel（由 init_worker 命令填充）
    pub result_tx: Arc<Mutex<Option<Channel<WorkerMessage>>>>,
}
