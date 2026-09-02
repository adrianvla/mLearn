"""Tests for pip_uninstall_plan dependency-closure removal."""

import json
import unittest
from types import SimpleNamespace

import pip_uninstall_plan as plan_module


def make_dist(name: str, requires: list[str] | None):
    return plan_module._SimpleDistribution(name, requires)


class PipUninstallPlanTest(unittest.TestCase):
    def test_removes_unreachable_candidate(self):
        installed = [
            make_dist("torch", ["nvidia-cudnn-cu12>=9.1", "filelock"]),
            make_dist("fastapi", ["starlette"]),
            make_dist("starlette", None),
        ]
        plan = plan_module.compute_plan(
            candidates=["torch", "starlette"],
            roots=["fastapi"],
            installed=installed,
        )
        self.assertEqual(plan["remove"], ["torch"])
        self.assertEqual(plan["keep"], ["starlette"])

    def test_extras_root_keeps_extra_dependency(self):
        # Language requirement "fugashi[unidic-lite]" must protect unidic-lite,
        # whose Requires-Dist edge is guarded by `extra == "unidic-lite"`.
        installed = [
            make_dist("fugashi", ['unidic-lite; extra == "unidic-lite"']),
            make_dist("unidic-lite", None),
        ]
        plan = plan_module.compute_plan(
            candidates=["unidic-lite"],
            roots=["fugashi[unidic-lite]"],
            installed=installed,
        )
        self.assertEqual(plan["remove"], [])
        self.assertEqual(plan["keep"], ["unidic-lite"])

    def test_plain_root_does_not_keep_extra_only_dependency(self):
        installed = [
            make_dist("fugashi", ['unidic-lite; extra == "unidic-lite"']),
            make_dist("unidic-lite", None),
        ]
        plan = plan_module.compute_plan(
            candidates=["unidic-lite"],
            roots=["fugashi"],
            installed=installed,
        )
        self.assertEqual(plan["remove"], ["unidic-lite"])
        self.assertEqual(plan["keep"], [])

    def test_transitive_cuda_dependency_survives_when_torch_stays(self):
        # voice-windows declares nvidia-cudnn-cu12/cublas explicitly while
        # llm-windows' cu128 torch needs them transitively. Disabling voice
        # alone must keep them.
        installed = [
            make_dist("torch", ["nvidia-cudnn-cu12>=9.1", "nvidia-cublas-cu12>=12.8"]),
            make_dist("nvidia-cudnn-cu12", None),
            make_dist("nvidia-cublas-cu12", None),
            make_dist("torchaudio", ["torch"]),
            make_dist("faster-whisper", ["ctranslate2"]),
            make_dist("ctranslate2", None),
        ]
        plan = plan_module.compute_plan(
            candidates=["torchaudio", "faster-whisper", "ctranslate2", "nvidia-cudnn-cu12", "nvidia-cublas-cu12"],
            roots=["torch==2.10.0+cu128"],
            installed=installed,
        )
        self.assertEqual(
            plan["remove"],
            ["ctranslate2", "faster-whisper", "torchaudio"],
        )
        self.assertEqual(plan["keep"], ["nvidia-cublas-cu12", "nvidia-cudnn-cu12"])

    def test_unparseable_dependency_edge_aborts_plan(self):
        # A dependency edge we cannot parse might hide a requirement on any
        # candidate, so the plan must abort instead of guessing.
        installed = [
            make_dist("weird", ["something>=1 ; python_version >= \"3\" and ("]),
            make_dist("something", None),
        ]
        plan = plan_module.compute_plan(
            candidates=["something"],
            roots=["weird"],
            installed=installed,
        )
        self.assertIn("error", plan)
    def test_unknown_root_is_ignored(self):
        plan = plan_module.compute_plan(
            candidates=["torch"],
            roots=["not-installed-package"],
            installed=[make_dist("torch", None)],
        )
        self.assertEqual(plan["remove"], ["torch"])


if __name__ == "__main__":
    unittest.main()
