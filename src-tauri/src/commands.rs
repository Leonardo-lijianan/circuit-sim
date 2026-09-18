// src-tauri/src/commands.rs

use crate::solver::{solve, SolverInput, SolverOutput};
use crate::worker::{SolverCommand, WorkerHandle, WorkerMessage};
use tauri::ipc::Channel;
use tauri::State;

/// 一次性求解（同步，无 Worker）
#[tauri::command]
pub fn solve_circuit(input: SolverInput) -> Result<Vec<SolverOutput>, String> {
    solve(&input).map_err(|e| e.to_string())
}

/// 初始化 Worker：前端传入结果接收 Channel
#[tauri::command]
pub fn init_worker(
    channel: Channel<WorkerMessage>,
    state: State<'_, WorkerHandle>,
) -> Result<(), String> {
    let mut lock = state.result_tx.lock().map_err(|e| e.to_string())?;
    *lock = Some(channel);
    Ok(())
}

/// 发送控制指令给 Worker
#[tauri::command]
pub fn send_command(
    cmd: String,
    payload: Option<SolverInput>,
    state: State<'_, WorkerHandle>,
) -> Result<(), String> {
    let command = match cmd.as_str() {
        "Start" => SolverCommand::Start,
        "Pause" => SolverCommand::Pause,
        "Stop" => SolverCommand::Stop,
        "UpdateInput" => {
            let input = payload.ok_or("UpdateInput 需要 payload")?;
            SolverCommand::UpdateInput(input)
        }
        "Shutdown" => SolverCommand::Shutdown,
        _ => return Err(format!("未知指令: {}", cmd)),
    };
    state
        .cmd_tx
        .send(command)
        .map_err(|e| e.to_string())?;
    Ok(())
}
