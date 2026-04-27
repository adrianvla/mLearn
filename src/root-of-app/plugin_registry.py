"""
Language module registry.

Replaces config.language_module single global. Each language registers
its module object here, keyed by language ID (e.g. "ja", "de").
Plugin language modules register themselves through register_language().
"""

from typing import Any, Dict, Optional

from logging_utils import get_logger

log = get_logger("plugins")

_registry: Dict[str, Any] = {}
_active_language: str = ""


def register_language(language_id: str, module: Any) -> None:
    """Register a language module under the given ID."""
    _registry[language_id] = module
    log.info(f"[plugin_registry] Registered language: {language_id}")


def get_language(language_id: str) -> Optional[Any]:
    """Return the module for language_id, or None if not registered."""
    return _registry.get(language_id)


def get_active() -> Optional[Any]:
    """Return the currently active language module (set by config.init())."""
    return _registry.get(_active_language)


def set_active(language_id: str) -> None:
    """Set which language ID is considered active."""
    global _active_language
    _active_language = language_id


def list_languages() -> list:
    """Return list of registered language IDs."""
    return list(_registry.keys())
