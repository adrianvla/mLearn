"""The installed package controller's single published runtime snapshot."""
import json
import os
import re
from contextvars import ContextVar

_admitted_root: ContextVar[str | None] = ContextVar("language_generation_root", default=None)


def resolve_language_data_root(controller_root: str) -> str:
    admitted = _admitted_root.get()
    if admitted is not None:
        return admitted
    pointer = os.path.join(controller_root, ".active-generation.json")
    if not os.path.isfile(pointer):
        return controller_root
    with open(pointer, encoding="utf-8") as source:
        payload = json.load(source)
    generation = payload.get("generation") if isinstance(payload, dict) else None
    if not isinstance(generation, str) or not re.fullmatch(r"[a-f0-9-]{36}", generation):
        raise RuntimeError("Invalid active language generation")
    root = os.path.join(controller_root, ".generations", generation)
    if not os.path.isdir(root):
        raise RuntimeError("Active language generation is missing")
    return root


def admit_language_generation(controller_root: str, generation: str | None = None):
    root = resolve_language_data_root(controller_root)
    if generation is not None and generation != os.path.basename(root):
        if not re.fullmatch(r"[a-f0-9-]{36}", generation):
            raise RuntimeError("Invalid candidate language generation")
        root = os.path.join(controller_root, ".generations", generation)
        if not os.path.isdir(root):
            raise RuntimeError("Candidate language generation is missing")
    return _admitted_root.set(root)


def release_language_generation(token):
    _admitted_root.reset(token)
