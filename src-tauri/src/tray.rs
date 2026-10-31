use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

const TRAY_ID: &str = "main";
const ICON: &[u8] = include_bytes!("../icons/tray.png");
const ICON_ATTENTION: &[u8] = include_bytes!("../icons/tray-attention.png");

pub struct TrayState {
    pause: MenuItem<Wry>,
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Tidra", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh all", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause background checks", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &pause, &separator, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON)?)
        .tooltip("Tidra")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            id => {
                let _ = app.emit("tray://action", id);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(TrayState { pause });
    Ok(())
}

#[tauri::command]
pub fn tray_set_attention(app: AppHandle, attention: bool, paused: bool) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("tray is not ready")?;
    let bytes = if attention { ICON_ATTENTION } else { ICON };
    tray.set_icon(Some(Image::from_bytes(bytes).map_err(|err| err.to_string())?)).map_err(|err| err.to_string())?;
    let tooltip = if attention { "Tidra: needs attention" } else { "Tidra" };
    tray.set_tooltip(Some(tooltip)).map_err(|err| err.to_string())?;
    let label = if paused { "Resume background checks" } else { "Pause background checks" };
    app.state::<TrayState>().pause.set_text(label).map_err(|err| err.to_string())
}
