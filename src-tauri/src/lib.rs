mod db;
mod env_path;
mod fs;
mod ports;
mod proc;
mod secrets;
mod tray;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

const HIDDEN_FLAG: &str = "--hidden";
const SHOW_FALLBACK: Duration = Duration::from_secs(5);

static STARTUP_SHOWN: AtomicBool = AtomicBool::new(false);

/// Shows the window the first time only, and never for autostart launches that should stay in the tray.
fn show_on_startup(app: &tauri::AppHandle) {
    if std::env::args().any(|arg| arg == HIDDEN_FLAG) || STARTUP_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    tray::show_main(app);
}

/// Called by the UI after its first paint, so the window never opens blank.
#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    show_on_startup(&app);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        // Visibility is ours to decide (see `app_ready`); restoring it would show a blank window early.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_FLAG])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(proc::Processes::default())
        .invoke_handler(tauri::generate_handler![
            app_ready,
            db::db_query,
            db::db_execute,
            db::db_exec_script,
            proc::proc_spawn,
            proc::proc_kill,
            proc::proc_which,
            proc::process_kill,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            fs::fs_read_text,
            fs::fs_write_text,
            fs::fs_read_dir,
            fs::fs_exists,
            fs::app_env,
            ports::ports_list,
            tray::tray_set_attention,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("tidra.db")).map_err(|err| err.to_string())?;
            app.manage(db::Db(Mutex::new(conn)));

            tray::create(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                show_on_startup(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides to the tray so background checks keep running; Quit lives in the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start Tidra");
}
