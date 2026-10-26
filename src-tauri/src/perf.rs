//! Startup measurements for docs/PERF.md.
//!
//! Each mark is written to the log (logcat on Android) and appended to `perf.log`
//! in the app data directory as one line:
//!   PERF <name> since_main_ms=<n> since_process_ms=<n|-> epoch_ms=<n> <detail>
//! `since_process_ms` counts from process creation and is available on Android and Linux.
//! On Windows and macOS the scripts in `scripts/` measure from the launch instead.

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::OnceLock;
use std::time::Instant;

use tauri::State;

use crate::storage::{Storage, now_ms};

static MAIN_START: OnceLock<Instant> = OnceLock::new();

pub fn init() {
    MAIN_START.get_or_init(Instant::now);
}

/// Milliseconds since the process was created, from /proc (clock ticks are 1/100 s).
#[cfg(any(target_os = "android", target_os = "linux"))]
fn since_process_ms() -> Option<u64> {
    let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
    // The command name may contain spaces, so count fields after the closing parenthesis.
    let after = &stat[stat.rfind(')')? + 2..];
    let start_ticks: f64 = after.split_whitespace().nth(19)?.parse().ok()?;
    let uptime: f64 = std::fs::read_to_string("/proc/uptime").ok()?.split_whitespace().next()?.parse().ok()?;
    Some(((uptime - start_ticks / 100.0) * 1000.0).max(0.0) as u64)
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn since_process_ms() -> Option<u64> {
    None
}

pub fn format_mark(name: &str, detail: &str) -> String {
    let since_main = MAIN_START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0);
    let since_process = since_process_ms().map_or("-".to_string(), |v| v.to_string());
    format!(
        "PERF {name} since_main_ms={since_main} since_process_ms={since_process} epoch_ms={} {detail}",
        now_ms()
    )
}

#[tauri::command]
pub fn perf_mark(storage: State<'_, Storage>, name: String, detail: Option<String>) {
    let line = format_mark(&name, detail.as_deref().unwrap_or(""));
    log::info!("{line}");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(storage.root.join("perf.log")) {
        let _ = writeln!(file, "{line}");
    }
}
