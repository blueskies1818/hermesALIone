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


class TestStreamingTtsOrder:
    @pytest.mark.asyncio
    async def test_audio_follows_sentence_order_even_if_synthesis_finishes_out_of_order(self):
        import json as _json
        import time as _time
        from unittest.mock import patch as _patch

        adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={}))
        app = web.Application()
        app.router.add_post("/v1/chat/completions", adapter._handle_chat_completions)
        sentences = [
            "This first sentence is by far the longest one in the whole reply, so it is slow to speak.",
            "The second sentence is of medium length.",
            "Short last one!",
        ]

        def slow_for_long_text(text, *a, **k):
            _time.sleep(len(text) / 400)  # longer text -> later finish
            return text

        async def fake_run_agent(**kwargs):
            cb = kwargs.get("stream_delta_callback")
            for s in sentences:
                cb(s + " ")
            cb(None)
            return {"final_response": " ".join(sentences), "messages": [], "api_calls": 1}, {}

        with _patch("tools.tts_streaming.stream_tts_to_buffer", side_effect=slow_for_long_text), \
             _patch.object(adapter, "_run_agent", side_effect=fake_run_agent):
            async with TestClient(TestServer(app)) as client:
                resp = await client.post("/v1/chat/completions", json={
                    "model": "t", "stream": True, "voice_mode": True,
                    "messages": [{"role": "user", "content": "hi"}],
                })
                body = await resp.text()

        audio = []
        for block in body.split("\n\n"):
            if block.startswith("event: hermes.tts.audio"):
                audio.append(_json.loads(block.split("data: ", 1)[1]))
        assert [a["text"] for a in audio] == sentences
        assert [a["index"] for a in audio] == [0, 1, 2]
