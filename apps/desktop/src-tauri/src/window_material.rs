//! Native window materials follow accepted preferences, never renderer input.
use mlearn_core::{Response, Snapshot, ThemeColors, ThemeDocument};
use mlearn_runtime::RuntimeExecutor;
use serde::Deserialize;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{Emitter, Manager, WebviewWindow};

const EVENT: &str = "window-material-changed";

#[cfg(target_os = "windows")]
#[path = "window_acrylic.rs"]
mod acrylic;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetiredTheme {
    id: String,
    name: String,
    colors: ThemeColors,
    radius: u32,
    replacement_id: String,
}

static PRESETS: LazyLock<Result<[ThemeDocument; 2], serde_json::Error>> = LazyLock::new(|| {
    Ok([
        serde_json::from_str(include_str!("../../../../resources/themes/quartz.json"))?,
        serde_json::from_str(include_str!(
            "../../../../resources/themes/dark-quartz.json"
        ))?,
    ])
});
static RETIRED: LazyLock<Result<Vec<RetiredTheme>, serde_json::Error>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../resources/themes/retired-built-ins.json"
    ))
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Appearance {
    translucent: bool,
    dark: bool,
    background: [u8; 3],
}

fn rgb(value: &str) -> Result<[u8; 3], String> {
    let value = value.get(1..7).ok_or("Invalid accepted theme color")?;
    let number = u32::from_str_radix(value, 16).map_err(|error| error.to_string())?;
    let bytes = number.to_be_bytes();
    Ok([bytes[1], bytes[2], bytes[3]])
}

fn appearance(theme: &ThemeDocument) -> Result<Appearance, String> {
    let presets = PRESETS.as_ref().map_err(|error| error.to_string())?;
    let retired = RETIRED.as_ref().map_err(|error| error.to_string())?;
    // Only the shipped translucent palettes opt in. An opaque Slate document or
    // a customized/independently authored palette does not inherit an OS effect.
    let preset = presets.iter().find(|preset| preset.id == theme.id);
    let translucent = preset.is_some_and(|preset| {
        preset.colors == theme.colors
            || retired.iter().any(|old| {
                old.id == theme.id
                    && old.name == theme.name
                    && old.radius == theme.radius
                    && old.colors == theme.colors
                    && old.replacement_id == preset.id
                    && theme.extensions.is_empty()
            })
    });
    let surface = rgb(&theme.colors.surface)?;
    let luminance =
        2126 * u32::from(surface[0]) + 7152 * u32::from(surface[1]) + 722 * u32::from(surface[2]);
    Ok(Appearance {
        translucent,
        dark: luminance < 1_280_000,
        background: rgb(&theme.colors.background)?,
    })
}

#[derive(Clone, Copy, Default)]
enum Effect {
    #[default]
    Opaque,
    #[cfg(target_os = "macos")]
    Vibrancy,
    #[cfg(target_os = "windows")]
    Mica,
    #[cfg(target_os = "windows")]
    Acrylic,
}

#[derive(Default)]
pub(super) struct WindowMaterial {
    revision: Option<u32>,
    appearance: Option<Appearance>,
    effect: Effect,
}

impl WindowMaterial {
    pub fn active(&self) -> bool {
        !matches!(self.effect, Effect::Opaque)
    }

    pub fn apply(&mut self, window: &WebviewWindow, snapshot: &Snapshot) -> Result<(), String> {
        if self
            .revision
            .is_some_and(|revision| snapshot.revision < revision)
        {
            return Ok(());
        }
        let desired = appearance(&snapshot.theme)?;
        self.revision = Some(snapshot.revision);
        if self.appearance == Some(desired) {
            return Ok(());
        }
        self.clear(window)?;
        window
            .set_theme(Some(if desired.dark {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            }))
            .map_err(|error| error.to_string())?;
        self.appearance = Some(desired);
        if desired.translucent {
            // Tauri 2.12's set_effects discards native apply failures. Use its
            // existing native dependency directly so fallback status is truthful.
            self.effect = apply_effect(window, desired);
        }
        window
            .set_background_color(Some(self.background(desired)))
            .map_err(|error| error.to_string())
    }

    fn background(&self, appearance: Appearance) -> tauri::window::Color {
        if self.active() {
            tauri::window::Color(0, 0, 0, 0)
        } else {
            let [r, g, b] = appearance.background;
            tauri::window::Color(r, g, b, 255)
        }
    }

    fn clear(&mut self, window: &WebviewWindow) -> Result<(), String> {
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = window;
        match self.effect {
            Effect::Opaque => {}
            #[cfg(target_os = "macos")]
            Effect::Vibrancy => {
                window_vibrancy::clear_vibrancy(window).map_err(|error| error.to_string())?;
            }
            #[cfg(target_os = "windows")]
            Effect::Mica => {
                window_vibrancy::clear_mica(window).map_err(|error| error.to_string())?
            }
            #[cfg(target_os = "windows")]
            Effect::Acrylic => {
                acrylic::set(window.hwnd().map_err(|error| error.to_string())?.0, None)?
            }
        }
        self.effect = Effect::Opaque;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn apply_effect(window: &WebviewWindow, _: Appearance) -> Effect {
    effect_or_opaque(
        window_vibrancy::apply_vibrancy(
            window,
            window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
            Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .map(|()| Effect::Vibrancy)
        .map_err(|error| error.to_string()),
    )
}

#[cfg(target_os = "windows")]
fn apply_effect(window: &WebviewWindow, appearance: Appearance) -> Effect {
    effect_or_opaque(
        match window_vibrancy::apply_mica(window, Some(appearance.dark)) {
            Ok(()) => Ok(Effect::Mica),
            Err(window_vibrancy::Error::UnsupportedPlatformVersion(_)) => {
                let [r, g, b] = appearance.background;
                window
                    .hwnd()
                    .map_err(|error| error.to_string())
                    .and_then(|hwnd| acrylic::set(hwnd.0, Some([r, g, b, 125])))
                    .map(|()| Effect::Acrylic)
            }
            Err(error) => Err(error.to_string()),
        },
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn effect_or_opaque(result: Result<Effect, String>) -> Effect {
    match result {
        Ok(effect) => effect,
        Err(error) => {
            eprintln!("Native window material unavailable; using opaque background: {error}");
            Effect::Opaque
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_effect(_: &WebviewWindow, _: Appearance) -> Effect {
    Effect::Opaque
}

pub(super) fn startup_snapshot(runtime: &mut mlearn_runtime::Runtime) -> Result<Snapshot, String> {
    match serde_json::from_str(&runtime.execute(r#"{"type":"snapshot"}"#))
        .map_err(|error| error.to_string())?
    {
        Response::Snapshot { snapshot } => Ok(snapshot),
        response => Err(format!("Cannot read startup preferences: {response:?}")),
    }
}

pub(super) fn initialization_script(theme: &ThemeDocument) -> Result<String, serde_json::Error> {
    Ok(format!(
        "if ({}.includes(location.origin)) Object.defineProperty(window, '__MLEARN_INITIAL_THEME__', {{value:{}}});",
        serde_json::to_string(super::media::ORIGINS)?,
        serde_json::to_string(theme)?,
    ))
}

pub(super) enum ThemeAction {
    Snapshot,
    Save,
    Other,
}

impl ThemeAction {
    pub fn from_request(request: &str) -> Self {
        #[derive(Deserialize)]
        struct Header<'a> {
            #[serde(rename = "type", borrow)]
            kind: &'a str,
        }
        match serde_json::from_str::<Header<'_>>(request).map(|header| header.kind) {
            Ok("snapshot") => Self::Snapshot,
            Ok("save_theme") => Self::Save,
            _ => Self::Other,
        }
    }

    pub fn accepted_snapshot(&self, runtime: &RuntimeExecutor, response: &str) -> Option<Snapshot> {
        match self {
            Self::Other => None,
            Self::Snapshot => match serde_json::from_str(response) {
                Ok(Response::Snapshot { snapshot }) => Some(snapshot),
                _ => None,
            },
            Self::Save => match serde_json::from_str::<Response>(response) {
                Ok(Response::Saved { .. }) => {
                    match serde_json::from_str(&runtime.execute(r#"{"type":"snapshot"}"#)) {
                        Ok(Response::Snapshot { snapshot }) => Some(snapshot),
                        result => {
                            eprintln!("Saved window theme awaits preference refresh: {result:?}");
                            None
                        }
                    }
                }
                _ => None,
            },
        }
    }
}

pub(super) async fn synchronize(
    app: &tauri::AppHandle,
    state: Arc<Mutex<WindowMaterial>>,
    snapshot: Snapshot,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    let (send, received) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let mut material = state.lock().map_err(|_| "Window material state poisoned")?;
                let before = material.active();
                material.apply(&target, &snapshot)?;
                let active = material.active();
                if active != before {
                    target
                        .emit(EVENT, active)
                        .map_err(|error| error.to_string())?;
                }
                Ok(())
            })();
            if send.send(result).is_err() {
                eprintln!("Window material request ended before its native update");
            }
        })
        .map_err(|error| error.to_string())?;
    received.await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn rejected_native_acrylic_keeps_an_opaque_background_and_reports_clear_failure() {
        let appearance = appearance(&PRESETS.as_ref().unwrap()[1]).unwrap();
        let applied = acrylic::set(std::ptr::null_mut(), Some([17, 34, 51, 125]));
        let material = WindowMaterial {
            effect: effect_or_opaque(applied.map(|()| Effect::Acrylic)),
            ..Default::default()
        };
        assert!(!material.active());
        let color = material.background(appearance);
        let [r, g, b] = appearance.background;
        assert_eq!((color.0, color.1, color.2, color.3), (r, g, b, 255));
        assert!(acrylic::set(std::ptr::null_mut(), None).is_err());
    }

    #[test]
    fn only_translucent_palettes_enable_material_without_reclassifying_custom_themes() {
        let presets = PRESETS.as_ref().unwrap();
        for preset in presets {
            assert!(appearance(preset).unwrap().translucent);
            let mut custom = preset.clone();
            custom.colors.background = "#123456".into();
            assert!(!appearance(&custom).unwrap().translucent);
            custom = preset.clone();
            custom.id = "school.custom".into();
            assert!(!appearance(&custom).unwrap().translucent);
        }
        let mut slate = presets[1].clone();
        slate.id = "mlearn.slate".into();
        slate.name = "Slate".into();
        assert!(!appearance(&slate).unwrap().translucent);
        assert!(appearance(&slate).unwrap().dark);
        assert!(!appearance(&presets[0]).unwrap().dark);
    }

    #[test]
    fn historical_quartz_startup_and_customization_share_the_import_fingerprints() {
        for old in RETIRED.as_ref().unwrap() {
            let document = ThemeDocument {
                id: old.id.clone(),
                name: old.name.clone(),
                colors: old.colors.clone(),
                radius: old.radius,
                ..Default::default()
            };
            assert_eq!(
                appearance(&document).unwrap().translucent,
                old.id == "mlearn.quartz"
            );
            let mut customized = document;
            customized.radius += 1;
            assert!(!appearance(&customized).unwrap().translucent);
        }
    }

    #[test]
    fn material_refresh_uses_the_committed_theme_and_ignores_rejected_settings() {
        let root = tempfile::tempdir().unwrap();
        let runtime = mlearn_runtime::Runtime::open(
            root.path(),
            mlearn_language_host::CodePolicy::DesktopDownloaded,
            None,
            vec![],
        )
        .unwrap();
        let executor = RuntimeExecutor::new(runtime);
        let action = ThemeAction::from_request(r#"{"type":"save_theme"}"#);
        let before = ThemeAction::Snapshot
            .accepted_snapshot(&executor, &executor.execute(r#"{"type":"snapshot"}"#))
            .unwrap();
        let dark = PRESETS.as_ref().unwrap()[1].clone();
        let save = mlearn_core::Request::SaveTheme {
            document: dark.clone(),
            expected_revision: before.revision,
            command_id: uuid::Uuid::new_v4().to_string(),
        };
        let saved = executor.execute(&serde_json::to_string(&save).unwrap());
        let accepted = action.accepted_snapshot(&executor, &saved).unwrap();
        assert_eq!(accepted.theme, dark);
        assert!(accepted.revision > before.revision);
        let mut invalid = dark.clone();
        invalid.name.clear();
        let rejected = executor.execute(
            &serde_json::to_string(&mlearn_core::Request::SaveTheme {
                document: invalid,
                expected_revision: accepted.revision,
                command_id: uuid::Uuid::new_v4().to_string(),
            })
            .unwrap(),
        );
        assert!(action.accepted_snapshot(&executor, &rejected).is_none());
        let after = ThemeAction::Snapshot
            .accepted_snapshot(&executor, &executor.execute(r#"{"type":"snapshot"}"#))
            .unwrap();
        assert_eq!(after.theme, dark);
        assert_eq!(after.revision, accepted.revision);
    }
}
