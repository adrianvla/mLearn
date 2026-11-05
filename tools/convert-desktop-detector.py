"""Explicit offline conversion of the retained tuned detector, never app code."""
import hashlib
import json
from pathlib import Path
import sys

import onnx
import paddle2onnx

source, destination = map(Path, sys.argv[1:3])
pins = {
    "inference.pdiparams": "85218d2e3d98f5a21c58b4220627be923a97aee5db3cc71f39536ab31ac53960",
    "inference.json": "0f1a7ec35da36173529c7a60238b7f7919e3831929c3f700ad90ad4896adecd5",
    "inference.yml": "7298d5ead546584af2504d03355f881ac7a7bc0eb1e282d3e159277c1d0af871",
}
for name, digest in pins.items():
    with (source / name).open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != digest:
            raise ValueError(f"Retained detector identity mismatch: {name}")
destination.parent.mkdir(parents=True, exist_ok=True)
paddle2onnx.export(
    str(source / "inference.json"),
    str(source / "inference.pdiparams"),
    save_file=str(destination),
    opset_version=17,
    enable_onnx_checker=True,
)
graph = onnx.load(destination)
onnx.checker.check_model(graph)
with destination.open("rb") as file:
    digest = hashlib.file_digest(file, "sha256").hexdigest()
print(json.dumps({
    "sha256": digest, "byteLength": destination.stat().st_size,
    "opsets": [{"domain": item.domain, "version": item.version} for item in graph.opset_import],
    "inputs": [str(item) for item in graph.graph.input],
    "outputs": [str(item) for item in graph.graph.output],
}, indent=2))
