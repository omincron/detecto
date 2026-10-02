"""config.py env parsing. Each test reloads backend.config, then restores it."""

import importlib

import pytest

from backend import config


@pytest.fixture
def env(monkeypatch):
    """MonkeyPatch for env vars; config is reloaded with the original env afterwards."""
    # reload() keeps attributes the module no longer defines, so drop values
    # set by other fixtures (restored by monkeypatch on teardown).
    monkeypatch.delattr(config, "WARMUP_MODEL", raising=False)
    monkeypatch.delattr(config, "MAX_UPLOAD_BYTES", raising=False)
    with pytest.MonkeyPatch.context() as mp:
        yield mp
    importlib.reload(config)


def test_env_overrides_and_types(env):
    """M1-config-01"""
    env.setenv("CONFIDENCE_THRESHOLD", "0.25")
    env.setenv("CORS_ORIGINS", "http://a.com,http://b.com")
    env.setenv("MODEL_PATH", "foo.pt")
    env.setenv("MAX_UPLOAD_BYTES", "2048")
    env.setenv("WARMUP_MODEL", "false")
    importlib.reload(config)

    assert config.CONFIDENCE_THRESHOLD == 0.25
    assert isinstance(config.CONFIDENCE_THRESHOLD, float)
    assert config.CORS_ORIGINS == ["http://a.com", "http://b.com"]
    assert config.MODEL_PATH == "foo.pt"
    assert config.MAX_UPLOAD_BYTES == 2048
    assert isinstance(config.MAX_UPLOAD_BYTES, int)
    assert config.WARMUP_MODEL is False


@pytest.mark.parametrize("raw, expected", [("0", False), ("true", True)])
def test_warmup_model_parsing(env, raw, expected):
    """M1-config-01 (WARMUP_MODEL values)"""
    env.setenv("WARMUP_MODEL", raw)
    importlib.reload(config)

    assert config.WARMUP_MODEL is expected


def test_defaults_when_unset(env):
    """M1-config-01 (defaults)"""
    env.delenv("MAX_UPLOAD_BYTES", raising=False)
    env.delenv("WARMUP_MODEL", raising=False)
    importlib.reload(config)

    assert config.MAX_UPLOAD_BYTES == 10 * 1024 * 1024
    assert config.WARMUP_MODEL is True
