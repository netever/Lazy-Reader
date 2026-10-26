//! Rust core of the reader: local files, hashes, reading state and startup marks.
//! The user interface lives in `src/` (TypeScript) and calls the commands registered below.

mod library;
mod perf;
mod state;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    perf::init();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let storage = storage::Storage::open(root)?;
            log::info!("data dir ready, device {}", storage.device_id);
            app.manage(storage);
            app.manage(library::Imports::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::import_begin,
            library::import_chunk,
            library::import_finish,
            library::import_cancel,
            library::list_books,
            library::get_book,
            library::read_book,
            library::read_book_range,
            library::update_book_info,
            state::load_state,
            state::save_state,
            state::load_settings,
            state::save_settings,
            state::device_id,
            perf::perf_mark,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
