//! Card Studio native shell: serves the web app (embedded assets) and adds
//! the two things a webview cannot do on its own: saving files where the user
//! wants them, and opening links in the system browser.

use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

/// Replaces characters that are not allowed in file names on any platform.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "card.png".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

/// `dir/name`, or `dir/name (2).ext` etc. when the file already exists.
#[cfg_attr(desktop, allow(dead_code))]
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str());
    for n in 2..10_000 {
        let file = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let p = dir.join(file);
        if !p.exists() {
            return p;
        }
    }
    candidate
}

#[cfg(desktop)]
fn write_file(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut dialog = app.dialog().file().set_file_name(name);
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(ext) = Path::new(name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None); // cancelled
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

#[cfg(mobile)]
fn write_file(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<Option<String>, String> {
    // Android: the shared Downloads folder (visible in the Files app).
    // Fallbacks: the app's documents folder (iOS Files app), then app data.
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "android")]
    dirs.push(PathBuf::from("/storage/emulated/0/Download/Card Studio"));
    if let Ok(d) = app.path().document_dir() {
        dirs.push(d.join("Card Studio"));
    }
    if let Ok(d) = app.path().app_data_dir() {
        dirs.push(d.join("exports"));
    }
    let mut last_error = String::from("no writable folder");
    for dir in dirs {
        if let Err(e) = std::fs::create_dir_all(&dir) {
            last_error = format!("{}: {e}", dir.display());
            continue;
        }
        let path = unique_path(&dir, name);
        match std::fs::write(&path, bytes) {
            Ok(()) => return Ok(Some(path.display().to_string())),
            Err(e) => last_error = format!("{}: {e}", path.display()),
        }
    }
    Err(last_error)
}

/// Saves the raw request body under the name given in the `x-file-name` header.
#[tauri::command]
async fn save_file(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let raw_name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("card.png");
    let name = sanitize_file_name(&percent_encoding::percent_decode_str(raw_name).decode_utf8_lossy());
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a binary body".into());
    };
    write_file(&app, &name, bytes)
}

/// Opens an http(s) link in the default browser.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file, open_url])
        .run(tauri::generate_context!())
        .expect("error while running Card Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("a/b:c?.png"), "a_b_c_.png");
        assert_eq!(sanitize_file_name("  ...  "), "card.png");
        assert_eq!(sanitize_file_name("Ember Wyrm.png"), "Ember Wyrm.png");
    }

    #[test]
    fn unique_paths() {
        let dir = std::env::temp_dir().join("card-studio-test-unique");
        std::fs::create_dir_all(&dir).unwrap();
        let first = unique_path(&dir, "x.png");
        std::fs::write(&first, b"1").unwrap();
        let second = unique_path(&dir, "x.png");
        assert_eq!(second.file_name().unwrap(), "x (2).png");
        std::fs::remove_file(first).unwrap();
    }
}
