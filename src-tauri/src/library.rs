//! Book import and reading.
//!
//! Import goes in chunks (begin → chunk… → finish) so that a book of hundreds of megabytes
//! never has to sit in memory as one piece, neither in the WebView nor here.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

use crate::storage::{JsonFile, Storage, check_id, now_ms, read_json, write_json};

pub const META_SCHEMA: u32 = 1;

/// `meta/<book-id>.json`, see docs/SPEC.md section 4.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BookMeta {
    pub schema: u32,
    pub book_id: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub sha256: String,
    #[serde(default)]
    pub previous_sha256: Vec<String>,
    pub file_name: String,
    pub format: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub language: Option<String>,
    pub added_at: i64,
    pub updated_at: i64,
    /// Local only: file size and the name of the local copy in `books/`.
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub local_file: String,
    /// Unknown fields are kept on rewrite.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Book format by file name and the first bytes of the file.
/// Names are compared case-insensitively ("BOOK.FB2" is FB2).
pub fn detect_format(file_name: &str, head: &[u8]) -> Option<&'static str> {
    let name = file_name.to_lowercase();
    let is_zip = head.starts_with(b"PK\x03\x04");
    if head.starts_with(b"%PDF-") {
        return Some("pdf");
    }
    if is_zip {
        // EPUB stores an uncompressed "mimetype" file first.
        if head.len() >= 58 && &head[30..38] == b"mimetype" && &head[38..58] == b"application/epub+zip" {
            return Some("epub");
        }
        if name.ends_with(".fb2.zip") || name.ends_with(".fbz") {
            return Some("fbz");
        }
        if name.ends_with(".cbz") {
            return Some("cbz");
        }
        if name.ends_with(".epub") {
            return Some("epub");
        }
        return None;
    }
    if head.len() >= 68 && (&head[60..68] == b"BOOKMOBI" || &head[60..68] == b"TEXtREAd") {
        return Some(if name.ends_with(".azw3") { "azw3" } else { "mobi" });
    }
    if name.ends_with(".fb2") {
        return Some("fb2");
    }
    let text = String::from_utf8_lossy(&head[..head.len().min(1024)]);
    if text.contains("<FictionBook") {
        return Some("fb2");
    }
    None
}

fn extension_for(format: &str) -> &'static str {
    match format {
        "epub" => "epub",
        "fb2" => "fb2",
        "fbz" => "fb2.zip",
        "cbz" => "cbz",
        "pdf" => "pdf",
        "azw3" => "azw3",
        "mobi" => "mobi",
        _ => "bin",
    }
}

struct PendingImport {
    file: fs::File,
    path: PathBuf,
    file_name: String,
    hasher: Sha256,
    head: Vec<u8>,
    size: u64,
}

#[derive(Default)]
pub struct Imports(Mutex<HashMap<String, PendingImport>>);

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn read_meta(storage: &Storage, book_id: &str) -> Result<BookMeta, String> {
    match read_json(&storage.meta_path(book_id)).map_err(|e| e.to_string())? {
        JsonFile::Ok(value) => serde_json::from_value(value).map_err(|e| e.to_string()),
        JsonFile::Missing => Err(format!("book not found: {book_id}")),
        JsonFile::Corrupt => Err(format!("meta file is corrupt: {book_id}")),
    }
}

fn write_meta(storage: &Storage, meta: &BookMeta) -> Result<(), String> {
    let value = serde_json::to_value(meta).map_err(|e| e.to_string())?;
    write_json(&storage.meta_path(&meta.book_id), &value).map_err(|e| e.to_string())
}

pub fn list_metas(storage: &Storage) -> Result<Vec<BookMeta>, String> {
    let mut books = Vec::new();
    let dir = fs::read_dir(storage.root.join("meta")).map_err(|e| e.to_string())?;
    for entry in dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        match read_meta(storage, id) {
            Ok(meta) => books.push(meta),
            Err(e) => log::warn!("skip meta {id}: {e}"),
        }
    }
    books.sort_by_key(|b| std::cmp::Reverse(b.added_at));
    Ok(books)
}

#[tauri::command]
pub async fn import_begin(
    storage: State<'_, Storage>,
    imports: State<'_, Imports>,
    file_name: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let path = storage.imports_dir().join(&id);
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let pending = PendingImport { file, path, file_name, hasher: Sha256::new(), head: Vec::new(), size: 0 };
    imports.0.lock().unwrap().insert(id.clone(), pending);
    Ok(id)
}

/// One chunk of the file, in one of two forms:
/// - desktop: raw binary body, the import id in the `x-import-id` header;
/// - Android: JSON `{ importId, base64 }`. Tauri on Android sends IPC through postMessage,
///   which cannot carry binary bodies (a Uint8Array would become a JSON array of numbers).
#[tauri::command]
pub async fn import_chunk(request: Request<'_>, imports: State<'_, Imports>) -> Result<(), String> {
    let decoded;
    let (id, bytes): (&str, &[u8]) = match request.body() {
        InvokeBody::Raw(bytes) => {
            let id = request.headers().get("x-import-id").and_then(|v| v.to_str().ok());
            (id.ok_or("missing x-import-id header")?, bytes)
        }
        InvokeBody::Json(value) => {
            let id = value.get("importId").and_then(Value::as_str).ok_or("missing importId")?;
            let data = value.get("base64").and_then(Value::as_str).ok_or("missing base64")?;
            decoded = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
            (id, &decoded)
        }
    };
    let mut map = imports.0.lock().unwrap();
    let pending = map.get_mut(id).ok_or("unknown import")?;
    pending.file.write_all(bytes).map_err(|e| e.to_string())?;
    pending.hasher.update(bytes);
    if pending.head.len() < 4096 {
        let take = (4096 - pending.head.len()).min(bytes.len());
        pending.head.extend_from_slice(&bytes[..take]);
    }
    pending.size += bytes.len() as u64;
    Ok(())
}

#[tauri::command]
pub async fn import_finish(
    storage: State<'_, Storage>,
    imports: State<'_, Imports>,
    import_id: String,
) -> Result<BookMeta, String> {
    let pending = imports.0.lock().unwrap().remove(&import_id).ok_or("unknown import")?;
    let PendingImport { mut file, path, file_name, hasher, head, size } = pending;
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    let Some(format) = detect_format(&file_name, &head) else {
        let _ = fs::remove_file(&path);
        return Err(format!("unsupported file: {file_name}"));
    };
    let sha256 = hex(&hasher.finalize());

    // The same file imported twice is one book.
    if let Some(existing) = list_metas(&storage)?.into_iter().find(|m| m.sha256 == sha256) {
        let _ = fs::remove_file(&path);
        return Ok(existing);
    }

    let book_id = uuid::Uuid::new_v4().to_string();
    let local_file = format!("{book_id}.{}", extension_for(format));
    fs::rename(&path, storage.books_dir().join(&local_file)).map_err(|e| e.to_string())?;
    let now = now_ms();
    let meta = BookMeta {
        schema: META_SCHEMA,
        book_id,
        aliases: Vec::new(),
        sha256,
        previous_sha256: Vec::new(),
        file_name,
        format: format.to_string(),
        title: None,
        authors: Vec::new(),
        language: None,
        added_at: now,
        updated_at: now,
        size,
        local_file,
        extra: Map::new(),
    };
    write_meta(&storage, &meta)?;
    log::info!("imported book {} ({}, {} bytes)", meta.book_id, meta.format, meta.size);
    Ok(meta)
}

#[tauri::command]
pub async fn import_cancel(imports: State<'_, Imports>, import_id: String) -> Result<(), String> {
    if let Some(pending) = imports.0.lock().unwrap().remove(&import_id) {
        drop(pending.file);
        let _ = fs::remove_file(pending.path);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_books(storage: State<'_, Storage>) -> Result<Vec<BookMeta>, String> {
    list_metas(&storage)
}

#[tauri::command]
pub async fn get_book(storage: State<'_, Storage>, book_id: String) -> Result<BookMeta, String> {
    check_id(&book_id)?;
    read_meta(&storage, &book_id)
}

/// The whole book as raw bytes (EPUB, FB2, CBZ, MOBI).
#[tauri::command]
pub async fn read_book(storage: State<'_, Storage>, book_id: String) -> Result<Response, String> {
    check_id(&book_id)?;
    let meta = read_meta(&storage, &book_id)?;
    let bytes = fs::read(storage.books_dir().join(&meta.local_file)).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// A byte range of the book. PDF.js asks only for the parts it needs,
/// so large PDFs open without reading the whole file.
#[tauri::command]
pub async fn read_book_range(
    storage: State<'_, Storage>,
    book_id: String,
    offset: u64,
    length: u64,
) -> Result<Response, String> {
    check_id(&book_id)?;
    let meta = read_meta(&storage, &book_id)?;
    let mut file = fs::File::open(storage.books_dir().join(&meta.local_file)).map_err(|e| e.to_string())?;
    let length = length.min(meta.size.saturating_sub(offset)).min(64 * 1024 * 1024);
    let mut buffer = vec![0u8; length as usize];
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    file.read_exact(&mut buffer).map_err(|e| e.to_string())?;
    Ok(Response::new(buffer))
}

/// Title and authors are known only after the engine parsed the book.
#[tauri::command]
pub async fn update_book_info(
    storage: State<'_, Storage>,
    book_id: String,
    title: Option<String>,
    authors: Vec<String>,
    language: Option<String>,
) -> Result<BookMeta, String> {
    check_id(&book_id)?;
    let mut meta = read_meta(&storage, &book_id)?;
    if meta.title == title && meta.authors == authors && meta.language == language {
        return Ok(meta);
    }
    meta.title = title;
    meta.authors = authors;
    meta.language = language;
    meta.updated_at = now_ms();
    write_meta(&storage, &meta)?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn epub_head() -> Vec<u8> {
        let mut head = b"PK\x03\x04".to_vec();
        head.resize(30, 0);
        head.extend_from_slice(b"mimetypeapplication/epub+zip");
        head
    }

    #[test]
    fn detects_formats_case_insensitively() {
        assert_eq!(detect_format("a.epub", &epub_head()), Some("epub"));
        assert_eq!(detect_format("no-extension", &epub_head()), Some("epub"));
        assert_eq!(detect_format("BOOK.FB2", b"<?xml version=\"1.0\"?>"), Some("fb2"));
        assert_eq!(detect_format("x.txt", b"<?xml version=\"1.0\"?><FictionBook>"), Some("fb2"));
        assert_eq!(detect_format("Book.FB2.ZIP", b"PK\x03\x04rest"), Some("fbz"));
        assert_eq!(detect_format("c.fbz", b"PK\x03\x04rest"), Some("fbz"));
        assert_eq!(detect_format("COMIC.CBZ", b"PK\x03\x04rest"), Some("cbz"));
        assert_eq!(detect_format("doc.bin", b"%PDF-1.7"), Some("pdf"));
        assert_eq!(detect_format("random.zip", b"PK\x03\x04rest"), None);
        assert_eq!(detect_format("notes.txt", b"hello"), None);
    }

    #[test]
    fn detects_mobi_by_header() {
        let mut head = vec![0u8; 60];
        head.extend_from_slice(b"BOOKMOBI");
        assert_eq!(detect_format("x.azw3", &head), Some("azw3"));
        assert_eq!(detect_format("x.mobi", &head), Some("mobi"));
    }

    #[test]
    fn meta_keeps_unknown_fields() {
        let json = serde_json::json!({
            "schema": 1, "bookId": "b", "sha256": "00", "fileName": "a.epub", "format": "epub",
            "addedAt": 1, "updatedAt": 1, "fromNewerVersion": { "x": 1 }
        });
        let meta: BookMeta = serde_json::from_value(json).unwrap();
        let back = serde_json::to_value(&meta).unwrap();
        assert_eq!(back["fromNewerVersion"]["x"], 1);
    }
}
