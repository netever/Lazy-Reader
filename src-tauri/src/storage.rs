//! Local data directory of the app and small file helpers.
//!
//! Layout inside the app data directory (the same names will be used in the cloud, see docs/SPEC.md):
//!   device.json                         this device's id
//!   settings.json                       local UI settings (not synced)
//!   books/<book-id>.<ext>               local copy of each imported book
//!   meta/<book-id>.json                 book description
//!   state/<book-id>/<device-id>.json    position, annotations, reading sessions
//!   perf.log                            startup measurements, see docs/PERF.md

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value, json};

pub struct Storage {
    pub root: PathBuf,
    pub device_id: String,
}

impl Storage {
    pub fn open(root: PathBuf) -> std::io::Result<Self> {
        for dir in ["books", "meta", "state", "imports"] {
            fs::create_dir_all(root.join(dir))?;
        }
        let device_id = load_or_create_device_id(&root.join("device.json"))?;
        Ok(Self { root, device_id })
    }

    pub fn books_dir(&self) -> PathBuf {
        self.root.join("books")
    }
    pub fn meta_path(&self, book_id: &str) -> PathBuf {
        self.root.join("meta").join(format!("{book_id}.json"))
    }
    pub fn state_path(&self, book_id: &str) -> PathBuf {
        self.root.join("state").join(book_id).join(format!("{}.json", self.device_id))
    }
    pub fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    pub fn imports_dir(&self) -> PathBuf {
        self.root.join("imports")
    }
}

/// Ids come from the frontend, so they must never escape the data directory.
pub fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok { Ok(()) } else { Err(format!("invalid id: {id:?}")) }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Write to a temporary file in the same directory, then rename over the target,
/// so a crash never leaves a half-written file.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().expect("path has a parent");
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

pub fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    let mut data = serde_json::to_vec_pretty(value)?;
    data.push(b'\n');
    write_atomic(path, &data)
}

pub enum JsonFile {
    Missing,
    Ok(Value),
    /// The file exists but is not valid JSON. It is never overwritten silently.
    Corrupt,
}

pub fn read_json(path: &Path) -> std::io::Result<JsonFile> {
    match fs::read(path) {
        Ok(bytes) => Ok(match serde_json::from_slice(&bytes) {
            Ok(value) => JsonFile::Ok(value),
            Err(_) => JsonFile::Corrupt,
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(JsonFile::Missing),
        Err(e) => Err(e),
    }
}

/// Keep a copy of a corrupt file next to it before it gets replaced.
pub fn backup_corrupt(path: &Path) -> std::io::Result<PathBuf> {
    let backup = path.with_extension(format!("corrupt-{}.json", now_ms()));
    fs::copy(path, &backup)?;
    log::warn!("corrupt JSON kept as {}", backup.display());
    Ok(backup)
}

fn load_or_create_device_id(path: &Path) -> std::io::Result<String> {
    if let JsonFile::Ok(value) = read_json(path)? {
        if let Some(id) = value.get("deviceId").and_then(Value::as_str) {
            if check_id(id).is_ok() {
                return Ok(id.to_string());
            }
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    write_json(path, &json!({ "deviceId": id, "createdAt": now_ms() }))?;
    Ok(id)
}

/// Overlay `incoming` onto `existing` at the top level. Fields the app does not know
/// (for example, written by a newer version) survive the rewrite.
pub fn overlay(existing: Option<Value>, incoming: Map<String, Value>) -> Value {
    let mut base = match existing {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    for (key, value) in incoming {
        base.insert(key, value);
    }
    Value::Object(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        // no temporary files left behind
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn device_id_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        let a = Storage::open(dir.path().to_path_buf()).unwrap().device_id;
        let b = Storage::open(dir.path().to_path_buf()).unwrap().device_id;
        assert_eq!(a, b);
        assert!(check_id(&a).is_ok());
    }

    #[test]
    fn ids_cannot_escape_data_dir() {
        assert!(check_id("../../etc").is_err());
        assert!(check_id("a/b").is_err());
        assert!(check_id("").is_err());
        assert!(check_id("0d7c-11aa").is_ok());
    }

    #[test]
    fn overlay_keeps_unknown_fields() {
        let existing = json!({ "schema": 1, "futureField": [1, 2], "position": { "old": true } });
        let incoming = json!({ "schema": 1, "position": { "new": true } });
        let merged = overlay(Some(existing), incoming.as_object().unwrap().clone());
        assert_eq!(merged["futureField"], json!([1, 2]));
        assert_eq!(merged["position"], json!({ "new": true }));
    }

    #[test]
    fn corrupt_json_is_detected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        fs::write(&path, b"{ not json").unwrap();
        assert!(matches!(read_json(&path).unwrap(), JsonFile::Corrupt));
        let backup = backup_corrupt(&path).unwrap();
        assert!(backup.exists());
    }
}
