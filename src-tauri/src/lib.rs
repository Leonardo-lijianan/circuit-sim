// src-tauri/src/lib.rs

pub mod solver;
pub mod worker;
pub mod commands;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 启动常驻 Worker
            let handle = worker::spawn_worker();
            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::solve_circuit,
            commands::init_worker,
            commands::send_command,
            commands::save_circuit_file,
            commands::load_circuit_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
