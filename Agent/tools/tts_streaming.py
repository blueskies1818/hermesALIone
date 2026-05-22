"""
Streaming TTS adapter — converts sentences to base64 audio chunks.

Wraps the existing TTS providers from tts_tool.py so that sentence-level
audio can be streamed to a frontend instead of being written to disk.
The primary consumer is the voice assistant (hermes.tts.audio SSE events).

Returns base64-encoded MP3 bytes for each sentence, ready for wire transport.
"""

import base64
import logging
import os
import re
import tempfile
import threading
from typing import Optional, Callable

logger = logging.getLogger(__name__)

# Sentence-boundary regex: split on .!? followed by whitespace or end-of-string,
# or on a double newline (paragraph break).  Also treat single newlines
# after 80+ chars as sentence boundaries (common in streaming chat output).
_SENTENCE_RE = re.compile(r'(?<=[.!?])\s+')

_MD_CODE_BLOCK = re.compile(r'```[\s\S]*?```')
_MD_INLINE_CODE = re.compile(r'`([^`]+)`')
_MD_LINK = re.compile(r'\[([^\]]*?)\]\([^)]+\)')
_MD_URL = re.compile(r'https?://\S+')
_MD_BOLD = re.compile(r'\*\*([^*]+)\*\*')
_MD_ITALIC = re.compile(r'\*([^*]+)\*')
_MD_HEADER = re.compile(r'^#{1,6}\s+', re.MULTILINE)
_MD_LIST_ITEM = re.compile(r'^\s*[-*+]\s+', re.MULTILINE)
_MD_HR = re.compile(r'^[-_*]{3,}\s*$', re.MULTILINE)
_MD_EXCESS_NL = re.compile(r'\n{3,}')


def strip_markdown(text: str) -> str:
    """Remove markdown formatting that shouldn't be spoken aloud."""
    text = _MD_CODE_BLOCK.sub(' ', text)
    text = _MD_LINK.sub(r'\1', text)
    text = _MD_URL.sub('', text)
    text = _MD_BOLD.sub(r'\1', text)
    text = _MD_ITALIC.sub(r'\1', text)
    text = _MD_INLINE_CODE.sub(r'\1', text)
    text = _MD_HEADER.sub('', text)
    text = _MD_LIST_ITEM.sub('', text)
    text = _MD_HR.sub('', text)
    text = _MD_EXCESS_NL.sub('\n\n', text)
    return text.strip()


class TtsSentenceBuffer:
    """Accumulates streaming text deltas and yields complete sentences.

    Splits on sentence-ending punctuation and newline breaks so each
    yielded chunk is a natural unit for TTS synthesis.
    """

    def __init__(self, min_sentence_len: int = 10, max_buffer_len: int = 300):
        self._buf = ""
        self._min_len = min_sentence_len
        self._max_len = max_buffer_len

    def feed(self, text: str) -> list[str]:
        """Feed a text delta.  Returns a list of complete sentences flushed."""
        self._buf += text
        flushed: list[str] = []

        # Flush complete sentences
        while True:
            m = _SENTENCE_RE.search(self._buf)
            if not m:
                break
            end = m.end()
            candidate = self._buf[:end].strip()
            if len(candidate) >= self._min_len:
                flushed.append(candidate)
                self._buf = self._buf[end:]
            else:
                # Too short — wait for more text
                break

        # Flush on paragraph break
        if '\n\n' in self._buf and not flushed:
            parts = self._buf.split('\n\n', 1)
            candidate = parts[0].strip()
            if len(candidate) >= self._min_len:
                flushed.append(candidate)
                self._buf = parts[1]

        # Force-flush if buffer is getting long with no punctuation
        if self._buf and len(self._buf) >= self._max_len and not flushed:
            flushed.append(self._buf.strip())
            self._buf = ""

        return flushed

    def flush_remaining(self) -> str:
        """Return and clear any remaining text (end of stream)."""
        remaining = self._buf.strip()
        self._buf = ""
        return remaining


def stream_tts_to_buffer(
    text: str,
    provider: Optional[str] = None,
    voice: Optional[str] = None,
) -> Optional[str]:
    """Synthesise *text* with the configured TTS provider and return base64
    MP3 audio bytes, or ``None`` if TTS is unavailable.

    This is a lightweight wrapper around the existing ``text_to_speech_tool``
    that writes to a temp file, reads it back, and encodes as base64.

    Args:
        text: The sentence to speak.
        provider: Optional provider override (default: config value).
        voice: Optional voice override (default: config value).

    Returns:
        Base64-encoded MP3 audio string, or None on failure.
    """
    try:
        from tools.tts_tool import text_to_speech_tool
        import json as _json
    except ImportError:
        logger.warning("tts_tool not available")
        return None

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        result_str = text_to_speech_tool(text=text, output_path=tmp_path)
        result = _json.loads(result_str)
        if not result.get("success", False):
            logger.warning("TTS generation failed: %s", result.get("error", "unknown"))
            return None

        file_path = result.get("file_path", tmp_path)
        with open(file_path, "rb") as f:
            audio_bytes = f.read()

        if not audio_bytes:
            return None

        return base64.b64encode(audio_bytes).decode("ascii")
    except Exception as exc:
        logger.warning("TTS streaming failed: %s", exc)
        return None
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Standalone test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    buf = TtsSentenceBuffer()
    test = "Hello world. This is a test of the sentence buffer. "
    test += "Here is a longer sentence without punctuation that just keeps going and going and going and going "
    test += "until the buffer length limit forces a flush because there are no periods to split on."

    for chunk in [test[:30], test[30:60], test[60:90], test[90:]]:
        sentences = buf.feed(chunk)
        for s in sentences:
            print(f"[SENTENCE] {s}")
    remaining = buf.flush_remaining()
    if remaining:
        print(f"[REMAINING] {remaining}")

    audio = stream_tts_to_buffer("This is a quick test of the streaming TTS adapter.")
    if audio:
        print(f"Audio generated: {len(audio)} base64 chars")
    else:
        print("No audio generated (TTS may not be configured)")
