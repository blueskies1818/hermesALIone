"""Theta: POST /v1/tts (read a message aloud) and its text chunker."""

from unittest.mock import patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter, tts_chunks


def _client(api_key: str = "") -> TestClient:
    extra = {"key": api_key} if api_key else {}
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra=extra))
    app = web.Application()
    app.router.add_post("/v1/tts", adapter._handle_tts)
    return TestClient(TestServer(app))


class TestTtsChunks:
    def test_short_text_is_one_chunk(self):
        assert tts_chunks("Hello there. How are you?") == ["Hello there. How are you?"]

    def test_paragraphs_merge_when_small(self):
        assert tts_chunks("One.\n\nTwo.") == ["One. Two."]

    def test_long_text_splits_at_sentences_within_limit(self):
        text = " ".join(f"Sentence number {i} is here." for i in range(100))
        chunks = tts_chunks(text, limit=120)
        assert len(chunks) > 1
        assert all(len(c) <= 120 for c in chunks)
        assert all(c.endswith(".") for c in chunks)
        assert " ".join(chunks) == text

    def test_unbroken_text_is_hard_split(self):
        chunks = tts_chunks("x" * 250, limit=100)
        assert all(len(c) <= 100 for c in chunks)
        assert "".join(chunks) == "x" * 250


class TestTtsEndpoint:
    @pytest.mark.asyncio
    async def test_returns_audio_chunks(self):
        with patch("tools.tts_streaming.stream_tts_to_buffer", return_value="QUJD"):
            async with _client() as client:
                resp = await client.post("/v1/tts", json={"text": "**Hello** world."})
                data = await resp.json()
        assert resp.status == 200
        assert data == {"success": True, "chunks": ["QUJD"]}

    @pytest.mark.asyncio
    async def test_missing_text_is_400(self):
        async with _client() as client:
            resp = await client.post("/v1/tts", json={"text": "  "})
        assert resp.status == 400

    @pytest.mark.asyncio
    async def test_provider_failure_is_502(self):
        with patch("tools.tts_streaming.stream_tts_to_buffer", return_value=None):
            async with _client() as client:
                resp = await client.post("/v1/tts", json={"text": "Hello."})
        assert resp.status == 502

    @pytest.mark.asyncio
    async def test_requires_key_when_configured(self):
        async with _client(api_key="sk-test") as client:
            resp = await client.post("/v1/tts", json={"text": "Hello."})
        assert resp.status == 401
