# Hermes Desktop — Voice Assistant

The Assistant tab provides an always-listening voice conversational agent with speech-to-text, text-to-speech, and real-time audio visualization.

## Architecture

```
Microphone → AnalyserNode → VAD → MediaRecorder → Base64 WAV
    ↓                                            ↓
Visualizer Canvas                        sendAudio IPC
    ↓                                            ↓
Frequency Bars                    Gateway STT Pipeline
                                                 ↓
                                          Transcript
                                                 ↓
                                    sendMessage (voice_mode)
                                                 ↓
                                         Agent Response
                                                 ↓
                                    TTS Audio SSE Events
                                                 ↓
                                    AudioPlayback Queue
                                                 ↓
                                           Speakers
```

## Voice Session States

The voice mode state machine has 7 states:

```
idle → listening → recording → transcribing → thinking → speaking → idle (loop)
                                                      ↑          ↓
                                                    error ←──────┘
```

| State | Description |
|-------|-------------|
| `idle` | No active session, waiting for mic activation |
| `listening` | Mic active, VAD polling, pre-roll buffering |
| `recording` | Speech detected, accumulating audio chunks |
| `transcribing` | Silence detected, sending audio to STT |
| `thinking` | Transcript sent to agent, awaiting response |
| `speaking` | Agent responding, TTS audio playing |
| `error` | Error state with message, auto-recovers |

## Core Files

| File | Size | Purpose |
|------|------|---------|
| `screens/Assistant/Assistant.tsx` | 15 KB | Assistant screen — mic setup, canvas visualizer, message display, model selector |
| `hooks/useVoiceMode.ts` | 14 KB | Voice state machine — VAD, MediaRecorder, TTS queue, debug info |
| `utils/audioCapture.ts` | 7 KB | WAV encoding (PCM 16-bit, mono), RMS computation, base64 output |
| `utils/audioPlayback.ts` | 5 KB | Sequential MP3 chunk playback via HTMLAudioElement + Blob URLs |

## VAD (Voice Activity Detection)

The VAD runs at 50ms intervals and uses RMS (Root Mean Square) energy detection on time-domain audio data from the Web Audio API AnalyserNode.

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `VAD_POLL_MS` | 50 | Analysis interval |
| `SILENCE_THRESHOLD` | 5 | RMS threshold (0-255) for speech detection |
| `MIN_SPEECH_SEC` | 0.3 | Sustained speech before recording starts |
| `SILENCE_SEC` | 2.0 | Sustained silence before transcribing |
| `MAX_WAIT_SEC` | 15.0 | Give up if no speech detected this long |
| `PRE_ROLL_CHUNKS` | 30 | ~3 seconds of audio buffered before speech detection |

### Pre-Roll Buffer

The MediaRecorder starts immediately when listening begins. Audio chunks accumulate in a sliding pre-roll buffer. The first chunk (containing the WebM header) is never dropped. When speech is detected, `recordingStartedRef` flips to true and subsequent chunks go to the main buffer. This preserves ~3 seconds of audio before the user started speaking — improving transcription accuracy for the first words.

### Recording Workflow

1. Mic toggled ON → `startMediaRecorder()` begins 100ms chunk capture into pre-roll buffer
2. VAD detects sustained speech (`MIN_SPEECH_SEC`) → `recordingStartedRef = true`, state → `recording`
3. VAD detects sustained silence (`SILENCE_SEC`) → state → `transcribing`, recorder stops
4. `stopMediaRecorder()` prepends pre-roll chunks to speech chunks → complete WebM blob
5. Blob converted to base64, sent via `sendAudio` IPC
6. Transcript returned → displayed in UI, sent to agent as chat message

### State Timeout

If listening with no speech for `MAX_WAIT_SEC` (15s), the recorder stops and returns to idle. The Auto-restart effect in Assistant.tsx re-activates listening after a 400ms delay while the mic is active.

## TTS (Text-to-Speech)

### Audio Playback (`audioPlayback.ts`)

`AudioPlayback` class provides sequential chunk playback:
- Each TTS chunk is converted to a Blob URL
- HTMLAudioElement plays each chunk in order via a promise-based queue
- State machine: `idle → playing → paused/stopped`
- Optional: Web Audio API analyser for visualizer integration (extracts frequency data)

### TTS Debug Info

The `useVoiceMode` hook tracks TTS pipeline state:

```typescript
interface TtsDebugInfo {
  chunksReceived: number;
  chunksPlayed: number;
  playbackState: string;
  lastError: string;
}
```

A debug indicator in the Assistant UI shows chunk pipeline state: `N recv · M queued · state`.

## Audio Visualizer

The canvas in `Assistant.tsx` renders a real-time frequency visualizer:
- **Mic mode**: Reads frequency data from the mic's AnalyserNode
- **TTS mode**: When agent is speaking, reads from the TTS playback's AnalyserNode
- **Smoothing**: Exponential moving average (0.65) on frequency bins
- **Normalization**: Decaying peak tracker normalizes bar heights
- **Visual**: Radial bar chart with gradient fill (#00ffcc → #ff007f), inner circle mask

## IPC Events

### Sent from Renderer
```typescript
window.hermesAPI.sendAudio(base64: string): Promise<TranscriptionResult>
window.hermesAPI.sendMessage(message, profile, sessionId, history, attachments, voiceMode)
window.hermesAPI.abortChat(): void
```

### Received from Main
```typescript
window.hermesAPI.onChatChunk((chunk: string) => void)
window.hermesAPI.onChatDone((sessionId?: string) => void)
window.hermesAPI.onChatError((error: string) => void)
window.hermesAPI.onTtsAudio((base64Chunk: string) => void)
```

## Continuous Conversation Loop

The Assistant is designed for continuous conversation:
1. Mic on → VAD starts → captures speech → transcribes → agent responds → TTS plays
2. Agent done → auto-restart VAD after 500ms
3. Agent error → auto-restart VAD after 2s
4. VAD timeout → returns to idle → auto-restart VAD after 400ms
5. Mic off → stops VAD, stops stream, closes audio context
