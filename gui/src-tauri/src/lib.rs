pub mod rpc;
pub mod supervisor;

use std::sync::Arc;
use supervisor::SupervisorState;
use tauri::{Manager, WindowEvent};

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
