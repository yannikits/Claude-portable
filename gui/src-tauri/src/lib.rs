pub mod rpc;
pub mod supervisor;

use serde_json::Value;
use std::sync::Arc;
use supervisor::SupervisorState;
use tauri::{Manager, WindowEvent};

#[tauri::command]
async fn rpc_call(
    state: tauri::State<'_, Arc<SupervisorState>>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let rpc_opt = state.rpc.lock().await.clone();
    let rpc = rpc_opt.ok_or_else(|| "sidecar not available".to_string())?;
    rpc.call(&method, params).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let state = Arc::new(SupervisorState::default());
            app.manage(state.clone());
            supervisor::start(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc_call])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<Arc<SupervisorState>>().inner().clone();
                    supervisor::graceful_shutdown(state).await;
                    app.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running claude-os-shell");
}
