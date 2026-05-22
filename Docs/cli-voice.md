# Hermes CLI — Voice Mode

Hermes supports both push-to-talk and continuous (VAD) voice interaction in the CLI, with configurable speech-to-text and text-to-speech providers.

## Voice Pipeline

```
Microphone → VAD → Recording → Base64 WAV → STT → Transcript → Agent → TTS → Audio Playback
```

## Recording Modes

### Push-to-Talk
- User presses a configurable key binding (default `Ctrl+B`) to start/stop recording
- Recording stops on key release or when max recording duration is reached

### Continuous (VAD)
- Always-on voice activity detection
- Auto-starts recording when speech is detected above the configured RMS threshold
- Auto-stops after sustained silence (configurable duration)
- Transcribes and passes to the agent callback
- Auto-restarts listening after the agent responds

## Speech-to-Text (STT)

Configured via `config.yaml` under the `stt:` key.

| Provider | Description |
|----------|-------------|
| **local** | Faster-whisper running locally (no API key needed) |
| **Groq** | Groq-hosted Whisper models |
| **OpenAI** | OpenAI Whisper API |
| **Mistral** | Mistral Voxtral models |
| **xAI** | xAI Grok STT |

Supported input formats: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg, aac.

Implementation: `Agent/tools/transcription_tools.py` (37 KB)

## Text-to-Speech (TTS)

Configured via `config.yaml` under the `tts:` key.

| Provider | Description |
|----------|-------------|
| **Edge TTS** | Microsoft Edge TTS (free, no API key) |
| **ElevenLabs** | High-quality neural voices |
| **OpenAI** | OpenAI TTS models |
| **xAI** | xAI TTS |
| **Mistral** | Mistral TTS |
| **Neuphonic** | Neuphonic TTS (via `neutts_synth.py`) |
| **Piper** | Local offline TTS |

Implementation: `Agent/tools/tts_tool.py` (90 KB)

### Streaming TTS

`Agent/tools/tts_streaming.py` (6 KB) converts sentences to base64 MP3 chunks for wire transport via SSE events. Strips markdown before speaking to ensure clean audio output.

## Voice Configuration

In `config.yaml`:

```yaml
voice:
  record_key: ctrl+b        # Key binding for push-to-talk
  max_recording_seconds: 120
  auto_tts: true            # Auto-speak agent responses
  beep: true                # Play beep on recording start/stop
  silence_threshold: 5      # RMS threshold for VAD
  silence_duration: 2.0     # Seconds of silence before stopping

stt:
  provider: local           # local, openai, groq, mistral, xai
  local_model: tiny         # tiny, base, small, medium, large-v3
  language: en

tts:
  provider: edge            # edge, elevenlabs, openai, xai, mistral, neutts, piper
  # Provider-specific settings (voice, model, speed, etc.)
```

## CLI Voice Files

| File | Size | Purpose |
|------|------|---------|
| `Agent/hermes_cli/voice.py` | 33 KB | Process-wide recording + TTS for TUI, key binding handling |
| `Agent/tools/voice_mode.py` | 39 KB | Core VAD state machine, recording loop, transcription integration |
| `Agent/tools/tts_tool.py` | 90 KB | Multi-provider TTS with voice/model selection |
| `Agent/tools/tts_streaming.py` | 6 KB | Streaming sentence-to-MP3 chunk converter |
| `Agent/tools/transcription_tools.py` | 37 KB | Multi-provider STT with format handling |
| `Agent/tools/neutts_synth.py` | — | Neuphonic TTS synthesis client |
