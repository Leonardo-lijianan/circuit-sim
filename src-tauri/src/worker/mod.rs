// src-tauri/src/worker/mod.rs

mod messages;
mod state;

pub use messages::{SolverCommand, WorkerMessage};
pub use state::WorkerHandle;

use crate::solver::{solve, SolverInput};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};

/// 求解间隔（毫秒）
const SOLVE_INTERVAL_MS: u64 = 100;

#[derive(Debug, Clone, PartialEq)]
enum WorkerState {
    Idle,
    Running,
    Paused,
    Stopped,
}

/// 启动常驻 Worker，返回句柄和 JoinHandle
pub fn spawn_worker() -> WorkerHandle {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let result_tx: Arc<Mutex<Option<Channel<WorkerMessage>>>> = Arc::new(Mutex::new(None));
    let result_tx_clone = result_tx.clone();

    tauri::async_runtime::spawn(async move {
        run_worker(cmd_rx, result_tx_clone).await;
    });

    WorkerHandle { cmd_tx, result_tx }
}

async fn run_worker(
    mut cmd_rx: mpsc::UnboundedReceiver<SolverCommand>,
    result_tx: Arc<Mutex<Option<Channel<WorkerMessage>>>>,
) {
    let mut state = WorkerState::Idle;
    let mut current_input: Option<SolverInput> = None;

    loop {
        match state {
            WorkerState::Idle | WorkerState::Stopped => {
                // 阻塞等待指令（0% CPU）
                let cmd = match cmd_rx.recv().await {
                    Some(c) => c,
                    None => break,
                };
                match cmd {
                    SolverCommand::Start => {
                        if current_input.is_some() {
                            state = WorkerState::Running;
                            send_state(&result_tx, "running");
                        } else {
                            send_error(&result_tx, "没有电路数据，无法启动仿真".to_string());
                        }
                    }
                    SolverCommand::UpdateInput(input) => {
                        current_input = Some(input);
                    }
                    SolverCommand::Stop => {
                        current_input = None;
                        send_state(&result_tx, "stopped");
                    }
                    SolverCommand::Shutdown => break,
                    _ => {}
                }
            }

            WorkerState::Running => {
                tokio::select! {
                    // 定时求解（为 Phase 8 动态仿真预留）
                    _ = sleep(Duration::from_millis(SOLVE_INTERVAL_MS)) => {
                        if let Some(input) = &current_input {
                            solve_and_send(input, &result_tx);
                        }
                    }
                    // 接收指令
                    cmd = cmd_rx.recv() => {
                        let cmd = match cmd {
                            Some(c) => c,
                            None => break,
                        };
                        match cmd {
                            SolverCommand::Pause => {
                                state = WorkerState::Paused;
                                send_state(&result_tx, "paused");
                            }
                            SolverCommand::Stop => {
                                state = WorkerState::Stopped;
                                current_input = None;
                                send_state(&result_tx, "stopped");
                            }
                            SolverCommand::UpdateInput(input) => {
                                // 立即求解一次，用户体验更好
                                solve_and_send(&input, &result_tx);
                                current_input = Some(input);
                            }
                            SolverCommand::Shutdown => break,
                            _ => {}
                        }
                    }
                }
            }

            WorkerState::Paused => {
                // 阻塞等待恢复/停止（0% CPU）
                let cmd = match cmd_rx.recv().await {
                    Some(c) => c,
                    None => break,
                };
                match cmd {
                    SolverCommand::Start => {
                        state = WorkerState::Running;
                        send_state(&result_tx, "running");
                    }
                    SolverCommand::Stop => {
                        state = WorkerState::Stopped;
                        current_input = None;
                        send_state(&result_tx, "stopped");
                    }
                    SolverCommand::UpdateInput(input) => {
                        current_input = Some(input);
                    }
                    SolverCommand::Shutdown => break,
                    _ => {}
                }
            }
        }
    }
}

// ============================================================
// 辅助
// ============================================================

fn solve_and_send(
    input: &SolverInput,
    result_tx: &Arc<Mutex<Option<Channel<WorkerMessage>>>>,
) {
    let message = match solve(input) {
        Ok(batch) => WorkerMessage::Output { batch },
        Err(e) => WorkerMessage::Error { message: e.to_string() },
    };
    send_message(result_tx, message);
}

fn send_error(result_tx: &Arc<Mutex<Option<Channel<WorkerMessage>>>>, msg: String) {
    send_message(result_tx, WorkerMessage::Error { message: msg });
}

fn send_state(result_tx: &Arc<Mutex<Option<Channel<WorkerMessage>>>>, state: &str) {
    send_message(
        result_tx,
        WorkerMessage::StateChanged { state: state.to_string() },
    );
}

fn send_message(
    result_tx: &Arc<Mutex<Option<Channel<WorkerMessage>>>>,
    message: WorkerMessage,
) {
    if let Ok(lock) = result_tx.lock() {
        if let Some(channel) = lock.as_ref() {
            let _ = channel.send(message);
        }
    }
}
