"""Offline historical reference packaging only, not a v3 resource installer.

Native resources use the Rust package_native_ocr publisher utility. This file
preserves the measured Python archive recipe, not a supported product executor.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile


def verify_inputs(runtime: Path, detector: Path, recognizer: Path, orientation: Path, manga: Path) -> None:
    """Refuse another variant/default under the measured executor identity."""
    pins = [
        (runtime / "lib/python3.11/site-packages/manga_ocr/ocr.py", "d3c84da74baadaeb86ee4570e2246b86450cd368f87ccf109bf4ade1c93ae0aa"),
        (detector / "inference.pdiparams", "85218d2e3d98f5a21c58b4220627be923a97aee5db3cc71f39536ab31ac53960"),
        (detector / "inference.json", "0f1a7ec35da36173529c7a60238b7f7919e3831929c3f700ad90ad4896adecd5"),
        (detector / "inference.yml", "7298d5ead546584af2504d03355f881ac7a7bc0eb1e282d3e159277c1d0af871"),
        (recognizer / "inference.pdiparams", "1b01c79a914587933f615569e75de54f2e638ebb5d3f3b3c1b38c24ede8c7319"),
        (orientation / "inference.pdiparams", "0de2bcf996cf553e2b848dd7b1769dafffc6917b1ccdf55c1d8efe7909fbf743"),
        (manga / "pytorch_model.bin", "c63e0bb5b3ff798c5991de18a8e0956c7ee6d1563aca6729029815eda6f5c2eb"),
        (manga / "config.json", "8c0e395de8fa699daaac21aee33a4ba9bd1309cfbff03147813d2a025f39f349"),
        (manga / "preprocessor_config.json", "af4eb4d79cf61b47010fc0bc9352ee967579c417423b4917188d809b7e048948"),
        (manga / "tokenizer_config.json", "d775ad1deac162dc56b84e9b8638f95ed8a1f263d0f56f4f40834e26e205e266"),
        (manga / "special_tokens_map.json", "303df45a03609e4ead04bc3dc1536d0ab19b5358db685b6f3da123d05ec200e3"),
        (manga / "vocab.txt", "344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d"),
    ]
    for path, expected in pins:
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError(f"Measured desktop OCR artifact changed: {path.name}")
    print("PINS_VERIFIED exact=True", flush=True)


def archive(destination: Path, sources: list[tuple[str, Path]]) -> dict[str, str | int]:
    """Build a regular-file-only archive with a separately authenticated inventory."""
    inventory: dict[str, dict[str, str | int]] = {}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as output:
        for prefix, source in sources:
            paths = sorted(source.rglob("*")) if source.is_dir() else [source]
            for path in paths:
                if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
                    continue
                relative = str(Path(prefix) / path.relative_to(source)) if source.is_dir() else prefix
                if relative in inventory:
                    raise RuntimeError(f"Duplicate archive path: {relative}")
                with path.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                inventory[relative] = {"sha256": digest, "byte_length": path.stat().st_size}
                # Dereference explicitly selected dependency/model symlinks into
                # ordinary bytes; no symlink/external-path authority is shipped.
                output.write(path.resolve(), relative)
        index = json.dumps(inventory, separators=(",", ":"), sort_keys=True).encode()
        output.writestr("inventory.json", index)
    with destination.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "sha256": digest,
        "byteLength": destination.stat().st_size,
        "indexSha256": hashlib.sha256(index).hexdigest(),
        "files": len(inventory),
        "expandedBytes": sum(int(entry["byte_length"]) for entry in inventory.values()),
    }


def main() -> None:
    """Explicit input paths are development packaging inputs, not app defaults."""
    arguments = sys.argv[1:]
    verify_only = "--verify-inputs" in arguments
    models_only = "--models-only" in arguments
    if models_only:
        arguments.remove("--models-only")
    if verify_only:
        arguments.remove("--verify-inputs")
    if len(arguments) != 6:
        raise RuntimeError("Usage: package-desktop-ocr.py OUTPUT RUNTIME DETECTOR PADDLE_RECOGNIZER ORIENTATION MANGA_SNAPSHOT")
    output, runtime, detector, recognizer, orientation, manga = map(Path, arguments)
    verify_inputs(runtime, detector, recognizer, orientation, manga)
    if verify_only:
        return
    output.mkdir(parents=True, exist_ok=True)
    if models_only:
        metadata = json.loads((output / "artifacts.json").read_text())
        with (output / "runtime.zip").open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != metadata["runtime"]["sha256"]:
                raise RuntimeError("Retained packaged runtime changed")
    else:
        metadata = {"runtime": archive(output / "runtime.zip", [
            ("bin/python3", runtime / "bin/python3"), ("lib", runtime / "lib"),
        ])}
    # Full Paddle recognition/orientation models remain reference inputs for the
    # measured comparison, not downloaded resources of the detector-only owner.
    metadata["models"] = archive(output / "models.zip", [("detector", detector), ("manga", manga)])
    (output / "artifacts.json").write_text(json.dumps(metadata, separators=(",", ":")))
    print("PACKAGED " + json.dumps(metadata), flush=True)


if __name__ == "__main__":
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    main()
