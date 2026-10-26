//! Reading state of a book on this device: `state/<book-id>/<device-id>.json`,
//! and local UI settings. Rules from docs/SPEC.md section 4:
//! unknown fields survive a rewrite, a file with a newer `schema` is never overwritten.

use std::path::Path;

use serde_json::Value;
use tauri::State;

use crate::storage::{JsonFile, Storage, backup_corrupt, check_id, overlay, read_json, write_json};

pub const STATE_SCHEMA: u64 = 1;

/// Decide what to write over the current file content.
pub fn merge_for_write(existing: Option<Value>, incoming: Value) -> Result<Value, String> {
    let Value::Object(incoming) = incoming else {
        return Err("state must be a JSON object".into());
    };
    if let Some(schema) = existing.as_ref().and_then(|v| v.get("schema")).and_then(Value::as_u64) {
        if schema > STATE_SCHEMA {
            return Err(format!(
                "state file has schema {schema}, this app knows {STATE_SCHEMA}; update the app"
            ));
        }
    }
    Ok(overlay(existing, incoming))
}

fn save_json_preserving(path: &Path, incoming: Value) -> Result<(), String> {
    let existing = match read_json(path).map_err(|e| e.to_string())? {
        JsonFile::Ok(value) => Some(value),
        JsonFile::Missing => None,
        JsonFile::Corrupt => {
            backup_corrupt(path).map_err(|e| e.to_string())?;
            None
        }
    };
    let merged = merge_for_write(existing, incoming)?;
    write_json(path, &merged).map_err(|e| e.to_string())
}

fn load_json(path: &Path) -> Result<Option<Value>, String> {
    match read_json(path).map_err(|e| e.to_string())? {
        JsonFile::Ok(value) => Ok(Some(value)),
        JsonFile::Missing => Ok(None),
        JsonFile::Corrupt => Err(format!("file is corrupt: {}", path.display())),
    }
}

#[tauri::command]
pub async fn load_state(storage: State<'_, Storage>, book_id: String) -> Result<Option<Value>, String> {
    check_id(&book_id)?;
    load_json(&storage.state_path(&book_id))
}

#[tauri::command]
pub async fn save_state(storage: State<'_, Storage>, book_id: String, state: Value) -> Result<(), String> {
    check_id(&book_id)?;
    save_json_preserving(&storage.state_path(&book_id), state)
}

#[tauri::command]
pub async fn load_settings(storage: State<'_, Storage>) -> Result<Option<Value>, String> {
    load_json(&storage.settings_path())
}

#[tauri::command]
pub async fn save_settings(storage: State<'_, Storage>, settings: Value) -> Result<(), String> {
    save_json_preserving(&storage.settings_path(), settings)
}

#[tauri::command]
pub fn device_id(storage: State<'_, Storage>) -> String {
    storage.device_id.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn refuses_to_overwrite_newer_schema() {
        let existing = json!({ "schema": 2, "position": {} });
        assert!(merge_for_write(Some(existing), json!({ "schema": 1 })).is_err());
    }

    #[test]
    fn keeps_unknown_fields() {
        let existing = json!({ "schema": 1, "extra": "keep me", "annotations": [] });
        let merged = merge_for_write(Some(existing), json!({ "schema": 1, "annotations": [1] })).unwrap();
        assert_eq!(merged["extra"], "keep me");
        assert_eq!(merged["annotations"], json!([1]));
    }

    #[test]
    fn corrupt_file_is_backed_up_not_lost() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, b"{broken").unwrap();
        save_json_preserving(&path, json!({ "schema": 1 })).unwrap();
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert!(names.iter().any(|n| n.contains("corrupt")), "{names:?}");
        assert_eq!(load_json(&path).unwrap().unwrap()["schema"], 1);
    }
}
