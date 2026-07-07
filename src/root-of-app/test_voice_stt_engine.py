import asyncio
import importlib
import sys
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

voice = importlib.import_module("routes.voice")


class VoiceSttEngineTests(unittest.TestCase):
    def test_stt_transcribe_options_mlx_strips_beam_size_and_vad_filter(self):
        """MLX engine must NOT receive beam_size or vad_filter (both unsupported, raise NotImplementedError)."""
        options = voice._stt_transcribe_options(
            "ja",
            engine="mlx",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
        )
        self.assertNotIn("beam_size", options)
        self.assertNotIn("vad_filter", options)
        self.assertEqual(options["language"], "ja")
        self.assertEqual(options["condition_on_previous_text"], False)
        self.assertEqual(options["no_speech_threshold"], 0.6)

    def test_stt_transcribe_options_mlx_renames_log_prob_threshold(self):
        """MLX uses `logprob_threshold` (no underscore), not `log_prob_threshold`."""
        options = voice._stt_transcribe_options(
            "ja", engine="mlx", log_prob_threshold=-1.0
        )
        self.assertNotIn("log_prob_threshold", options)
        self.assertIn("logprob_threshold", options)
        self.assertEqual(options["logprob_threshold"], -1.0)

    def test_stt_transcribe_options_faster_whisper_passes_through(self):
        """faster-whisper engine receives ALL params unchanged (beam_size, vad_filter, log_prob_threshold all valid)."""
        options = voice._stt_transcribe_options(
            "ja",
            engine="faster-whisper",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            log_prob_threshold=-1.0,
        )
        self.assertEqual(options["beam_size"], 5)
        self.assertEqual(options["vad_filter"], True)
        self.assertEqual(options["log_prob_threshold"], -1.0)
        self.assertNotIn("logprob_threshold", options)

    def test_stt_transcribe_options_no_language_hint(self):
        """When language hint is None/empty, no `language` key in result."""
        with mock.patch.object(voice, "_stt_language_hint", return_value=None):
            options = voice._stt_transcribe_options(None, engine="mlx")
        self.assertNotIn("language", options)

    def test_is_apple_silicon_darwin_arm64(self):
        with mock.patch("sys.platform", "darwin"), mock.patch(
            "platform.machine", return_value="arm64"
        ):
            self.assertTrue(getattr(voice, "_is_apple_silicon")())

    def test_is_apple_silicon_darwin_intel(self):
        with mock.patch("sys.platform", "darwin"), mock.patch(
            "platform.machine", return_value="x86_64"
        ):
            self.assertFalse(getattr(voice, "_is_apple_silicon")())

    def test_is_apple_silicon_linux(self):
        with mock.patch("sys.platform", "linux"), mock.patch(
            "platform.machine", return_value="x86_64"
        ):
            self.assertFalse(getattr(voice, "_is_apple_silicon")())

    def test_is_apple_silicon_windows(self):
        with mock.patch("sys.platform", "win32"), mock.patch(
            "platform.machine", return_value="AMD64"
        ):
            self.assertFalse(getattr(voice, "_is_apple_silicon")())

    def test_get_stt_engine_apple_silicon_defaults_mlx(self):
        with mock.patch.object(voice, "_is_apple_silicon", return_value=True):
            self.assertEqual(getattr(voice, "_get_stt_engine")(), "mlx")

    def test_get_stt_engine_non_apple_defaults_faster_whisper(self):
        with mock.patch.object(voice, "_is_apple_silicon", return_value=False):
            self.assertEqual(getattr(voice, "_get_stt_engine")(), "faster-whisper")

    def test_get_stt_engine_override_mlx_community_repo(self):
        with mock.patch.object(voice, "_is_apple_silicon", return_value=True), mock.patch.object(
            voice,
            "_voice_settings",
            return_value={"sttModel": "mlx-community/whisper-small-mlx"},
        ):
            self.assertEqual(getattr(voice, "_get_stt_engine")(), "mlx")

    def test_get_stt_engine_override_mlx_on_non_apple_silicon_rejected(self):
        with mock.patch.object(voice, "_is_apple_silicon", return_value=False), mock.patch.object(
            voice,
            "_voice_settings",
            return_value={"sttModel": "mlx-community/whisper-small-mlx"},
        ):
            self.assertEqual(getattr(voice, "_get_stt_engine")(), "faster-whisper")

    def test_get_stt_engine_override_non_mlx(self):
        with mock.patch.object(voice, "_is_apple_silicon", return_value=True), mock.patch.object(
            voice, "_voice_settings", return_value={"sttModel": "large-v3-turbo"}
        ):
            self.assertEqual(getattr(voice, "_get_stt_engine")(), "faster-whisper")

    def test_get_stt_engine_override_empty_uses_platform(self):
        with mock.patch.object(voice, "_is_apple_silicon", return_value=True), mock.patch.object(
            voice, "_voice_settings", return_value={"sttModel": ""}
        ):
            self.assertEqual(getattr(voice, "_get_stt_engine")(), "mlx")

    def test_run_stt_mlx_engine(self):
        """MLX engine: calls model.generate(), extracts .text and .language from STTOutput-shaped result."""
        mock_result = mock.MagicMock()
        mock_result.text = "こんにちは"
        mock_result.language = "ja"
        mock_result.segments = [{"id": 0, "text": "こんにちは"}]

        mock_model = mock.MagicMock()
        mock_model.generate = mock.MagicMock(return_value=mock_result)

        mock_state = {
            "model": mock_model,
            "engine": "mlx",
            "model_id": "mlx-community/whisper-large-v3-turbo-asr-fp16",
        }

        audio_np = np.zeros(16000, dtype=np.float32)
        with mock.patch.object(voice, "_ensure_stt_loaded", return_value=mock_state):
            loop = asyncio.new_event_loop()
            try:
                text, lang, segments = loop.run_until_complete(
                    getattr(voice, "_run_stt")(audio_np, "ja", partial=False)
                )
            finally:
                loop.close()

        self.assertEqual(text, "こんにちは")
        self.assertEqual(lang, "ja")
        self.assertEqual(len(segments), 1)
        mock_model.generate.assert_called_once()
        mock_model.transcribe.assert_not_called()

    def test_run_stt_faster_whisper_engine(self):
        """FW engine: calls model.transcribe(), joins segment texts, extracts language from info."""
        mock_segment = mock.MagicMock()
        mock_segment.text = "  hello"
        mock_info = mock.MagicMock()
        mock_info.language = "en"

        mock_model = mock.MagicMock()
        mock_model.transcribe = mock.MagicMock(return_value=([mock_segment], mock_info))

        mock_state = {"model": mock_model, "engine": "faster-whisper", "model_id": "small"}

        audio_np = np.zeros(16000, dtype=np.float32)
        with mock.patch.object(voice, "_ensure_stt_loaded", return_value=mock_state):
            loop = asyncio.new_event_loop()
            try:
                text, lang, segments = loop.run_until_complete(
                    getattr(voice, "_run_stt")(audio_np, "en", partial=False)
                )
            finally:
                loop.close()

        self.assertEqual(text, "hello")
        self.assertEqual(lang, "en")
        mock_model.transcribe.assert_called_once()
        mock_model.generate.assert_not_called()

    def test_stt_default_model_id_mlx(self):
        self.assertEqual(
            getattr(voice, "_stt_default_model_id")("mlx"),
            "mlx-community/whisper-large-v3-turbo-asr-fp16",
        )

    def test_stt_default_model_id_fw_cuda(self):
        with mock.patch.object(voice, "_get_stt_device", return_value="cuda"):
            self.assertEqual(getattr(voice, "_stt_default_model_id")("faster-whisper"), "large-v3-turbo")

    def test_stt_default_model_id_fw_cpu(self):
        with mock.patch.object(voice, "_get_stt_device", return_value="cpu"):
            self.assertEqual(getattr(voice, "_stt_default_model_id")("faster-whisper"), "small")


if __name__ == "__main__":
    unittest.main()
