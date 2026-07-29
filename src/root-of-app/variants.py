"""Language metadata variant overlays.

Keep this allowlist in parity with src/shared/languageVariants.ts.
"""

from typing import Any

from logging_utils import get_logger  # pyright: ignore[reportImplicitRelativeImport]


log = get_logger("variants")

VARIANT_OVERLAY_ALLOWLIST = (
    "name",
    "name_translated",
    "flagEmoji",
    "grammar",
    "conversation.tutorPromptGuidelines",
    "conversation.correctionPromptGuidelines",
    "conversation.mistakeCheckerPromptGuidelines",
    "typography.subtitleFontFamily",
    "typography.contentFontFamily",
    "runtime.ocr.paddleLang",
    "runtime.tts.webSpeechLang",
    "runtime.tts.diagnosticText",
    "runtime.adapter.config",
    "runtime.diagnostics.sampleText",
)

_ALLOWLIST_SET = frozenset(VARIANT_OVERLAY_ALLOWLIST)


def _set_dotted_path(target: dict[str, Any], path: str, value: Any) -> None:
    segments = path.split(".")
    node = target
    for segment in segments[:-1]:
        child = node.get(segment)
        next_node = dict(child) if isinstance(child, dict) else {}
        node[segment] = next_node
        node = next_node
    node[segments[-1]] = value


def _override_paths(overrides: dict[str, Any]) -> list[tuple[str, Any]]:
    paths: list[tuple[str, Any]] = []

    def visit(path: str, value: Any) -> None:
        if path in _ALLOWLIST_SET or not isinstance(value, dict):
            paths.append((path, value))
            return
        for key, child in value.items():
            visit(f"{path}.{key}" if path else key, child)

    for key, value in overrides.items():
        visit(key, value)
    return paths


def apply_variant_overlay(metadata: dict[str, Any], variant_id: str | None) -> dict[str, Any]:
    """Return metadata with an active variant's allowlisted values replaced."""
    if not variant_id or not isinstance(metadata, dict):
        return metadata
    variants = metadata.get("variants")
    if not isinstance(variants, dict):
        return metadata
    variant = variants.get(variant_id)
    if not isinstance(variant, dict):
        return metadata
    overrides = variant.get("overrides")
    if not isinstance(overrides, dict):
        return metadata

    result = dict(metadata)
    for path, value in _override_paths(overrides):
        if path not in _ALLOWLIST_SET:
            log.warning("Variant override path not in VARIANT_OVERLAY_ALLOWLIST: %s", path)
            continue
        _set_dotted_path(result, path, value)
    return result
