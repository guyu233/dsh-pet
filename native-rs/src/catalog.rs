//! Pet download/management data layer — ported from petdex
//! crafter-station/petdex (MIT) crates/petdex-windows/src/catalog_client.rs.
//! Adapted: pets live under ~/.dsh/pets (DSH) instead of ~/.petdex/pets.

use std::path::PathBuf;

pub const CATALOG_BASE_URL: &str = "https://petdex.dev";
pub const CATALOG_ASSETS_BASE_URL: &str = "https://assets.petdex.dev";
pub const DEFAULT_SEARCH_LIMIT: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePetEntry {
    pub slug: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallMetadata {
    pub slug: String,
    pub display_name: String,
    pub spritesheet_url: Option<String>,
    pub pet_json_url: Option<String>,
}

/// petdex sanitize_slug: lowercase, 1..=64 ASCII alnum/-/_, no leading/trailing '-'.
pub fn sanitize_slug(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().to_ascii_lowercase();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(format!("invalid pet slug: '{raw}'"));
    }
    if !trimmed.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(format!("invalid pet slug: '{raw}'"));
    }
    // petdex rejects path-traversal-ish shapes explicitly.
    if trimmed.starts_with('-') || trimmed.ends_with('-') || trimmed.contains("..") {
        return Err(format!("invalid pet slug: '{raw}'"));
    }
    Ok(trimmed)
}

pub fn build_install_metadata_url(slug: &str) -> Result<String, String> {
    Ok(format!("{CATALOG_BASE_URL}/api/install-pet/{}", sanitize_slug(slug)?))
}

/// DSH adaptation: ~/.dsh/pets/<slug> instead of petdex's ~/.petdex/pets/<slug>.
pub fn pet_install_dir(slug: &str) -> Result<PathBuf, String> {
    let clean = sanitize_slug(slug)?;
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "unable to locate USERPROFILE/HOME".to_string())?;
    Ok(home.join(".dsh").join("pets").join(clean))
}

pub fn build_asset_urls(slug: &str) -> Result<(String, String), String> {
    let clean = sanitize_slug(slug)?;
    Ok((
        format!("{CATALOG_ASSETS_BASE_URL}/pets/{clean}/spritesheet.webp"),
        format!("{CATALOG_ASSETS_BASE_URL}/pets/{clean}/pet.json"),
    ))
}

/// Resolve a possibly-relative asset URL (petdex resolve_asset_url).
pub fn resolve_asset_url(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() { return None }
    if t.starts_with("https://") || t.starts_with("http://") { return Some(t.to_string()) }
    if t.starts_with('/') { return Some(format!("{CATALOG_BASE_URL}{t}")) }
    None
}

/// Minimal JSON string field extraction (petdex's hand-rolled parser style,
/// no external crates to keep the binary small).
pub fn extract_string_field(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let at = json.find(&needle)? + needle.len();
    let rest = &json[at..];
    let colon = rest.find(':')?;
    let rest = rest[colon + 1..].trim_start();
    if !rest.starts_with('"') { return None }
    let bytes = rest.as_bytes();
    let mut i = 1;
    let mut out = String::new();
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '\\' && i + 1 < bytes.len() {
            i += 1;
            out.push(bytes[i] as char);
        } else if c == '"' { break }
        else { out.push(c) }
        i += 1;
    }
    Some(out)
}

/// Parse the install-metadata response (petdex parse_install_metadata_response).
pub fn parse_install_metadata(json: &str) -> Option<InstallMetadata> {
    let slug = sanitize_slug(&extract_string_field(json, "slug")?).ok()?;
    let display_name = extract_string_field(json, "displayName").unwrap_or_else(|| slug.clone());
    let sheet = extract_string_field(json, "spritesheetUrl")
        .or_else(|| extract_string_field(json, "spritesheetPath"))
        .and_then(|u| resolve_asset_url(&u));
    let pj = extract_string_field(json, "petJsonUrl").and_then(|u| resolve_asset_url(&u));
    Some(InstallMetadata { slug, display_name, spritesheet_url: sheet, pet_json_url: pj })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn slug_validation_matches_petdex() {
        assert_eq!(sanitize_slug("Cozy-Cat").unwrap(), "cozy-cat");
        assert_eq!(sanitize_slug("boba_2").unwrap(), "boba_2");
        assert!(sanitize_slug("../evil").is_err());
        assert!(sanitize_slug("-bad").is_err());
        assert!(sanitize_slug("bad-").is_err());
        assert!(sanitize_slug("has space").is_err());
    }
    #[test]
    fn metadata_urls() {
        assert_eq!(
            build_install_metadata_url("Cozy-Cat").unwrap(),
            "https://petdex.dev/api/install-pet/cozy-cat"
        );
        let (sheet, meta) = build_asset_urls("cozy-cat").unwrap();
        assert_eq!(sheet, "https://assets.petdex.dev/pets/cozy-cat/spritesheet.webp");
        assert_eq!(meta, "https://assets.petdex.dev/pets/cozy-cat/pet.json");
    }
    #[test]
    fn parse_install_metadata_resolves_relative_url() {
        let payload = r#"{"ok":true,"pet":{"slug":"cozy-cat","displayName":"Cozy Cat","spritesheetUrl":"https://assets.petdex.dev/pets/cozy-cat/spritesheet.webp","petJsonUrl":"/pets/cozy-cat/pet.json"}}"#;
        let meta = parse_install_metadata(payload).unwrap();
        assert_eq!(meta.slug, "cozy-cat");
        assert_eq!(meta.display_name, "Cozy Cat");
        assert_eq!(meta.pet_json_url.as_deref(), Some("https://petdex.dev/pets/cozy-cat/pet.json"));
    }
    #[test]
    fn install_dir_uses_dsh_home() {
        let d = pet_install_dir("boba").unwrap();
        let s = d.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("/.dsh/pets/boba"), "got {s}");
    }
}
