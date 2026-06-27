import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import config
import logging_utils


class OneArgLanguage:
    def __init__(self):
        self.calls = []

    def LOAD_MODULE(self, resource_path):
        self.calls.append((resource_path,))


class TwoArgLanguage:
    def __init__(self):
        self.calls = []

    def LOAD_MODULE(self, resource_path, cache_path):
        self.calls.append((resource_path, cache_path))


def test_load_language_module_preserves_one_arg_language_modules():
    language = OneArgLanguage()

    config._load_language_module(language, "/app/resources", "/users/adrian/cache")

    assert language.calls == [("/app/resources",)]


def test_load_language_module_passes_cache_path_when_supported():
    language = TwoArgLanguage()

    config._load_language_module(language, "/app/resources", "/users/adrian/cache")

    assert language.calls == [("/app/resources", "/users/adrian/cache")]


def test_logging_crash_path_is_under_user_data_logs(tmp_path):
    log_dir = logging_utils.set_log_dir(str(tmp_path))

    assert log_dir == str(tmp_path / "logs")
    assert logging_utils.get_crash_log_path() == str(tmp_path / "logs" / "python_crash.log")


def test_server_faulthandler_uses_configured_crash_log_path():
    server_source = Path(__file__).with_name("server.py").read_text(encoding="utf-8")
    startup_source = server_source[server_source.index("async def startup_event") :]

    assert "get_crash_log_path()" in startup_source
    assert 'os.path.join(config.RESPATH, "python_crash.log")' not in startup_source
