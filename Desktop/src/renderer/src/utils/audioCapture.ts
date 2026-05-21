/**
 * Browser-side audio capture — WAV encoding, RMS-based VAD, base64 output.
 *
 * Designed to work with the AnalyserNode already connected in the Assistant
 * visualizer.  Shares the same AudioContext / MediaStream so the visualization
 * and recording use a single mic permission.
 */

// ---------------------------------------------------------------------------
// WAV encoding (PCM 16-bit, mono, configurable sample rate)
// ---------------------------------------------------------------------------

export function encodeWav(
  samples: Float32Array,
  sampleRate: number = 16000,
): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * blockAlign;
  const bufferSize = 44 + dataSize;

  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, bufferSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write samples as int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// RMS-based Voice Activity Detection
// ---------------------------------------------------------------------------

/**
 * Compute RMS energy from AnalyserNode time-domain data (0–255 centred at 128).
 * Returns a value in the 0–255 range suitable for threshold comparison.
 */
export function computeRms(samples: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = (samples[i] - 128) / 128; // -1.0 to 1.0
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length) * 255;
}

// ---------------------------------------------------------------------------
// Recording state machine
// ---------------------------------------------------------------------------

export type RecordState =
  | "idle"
  | "listening"
  | "recording"
  | "silence"
  | "done";

export interface VadConfig {
  /** RMS threshold (0–255) above which audio is considered speech. */
  threshold: number;
  /** Seconds of continuous speech to confirm recording has started. */
  minSpeechDuration: number;
  /** Seconds of silence after speech to auto-stop recording. */
  silenceDuration: number;
  /** Seconds of listening with no speech before timing out. */
  maxWait: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 25,
  silenceDuration: 2.0,
  minSpeechDuration: 0.3,
  maxWait: 15.0,
};

export class AudioRecorder {
  readonly sampleRate = 16000;

  private _config: VadConfig;
  private _state: RecordState = "idle";
  private _chunks: Float32Array[] = [];
  private _speechTimer = 0;
  private _silenceTimer = 0;
  private _listenTimer = 0;
  private _onStateChange?: (state: RecordState) => void;

  constructor(config?: Partial<VadConfig>) {
    this._config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  get state(): RecordState {
    return this._state;
  }

  set onStateChange(cb: ((state: RecordState) => void) | undefined) {
    this._onStateChange = cb;
  }

  /** Reset to idle, discarding any in-progress recording. */
  reset(): void {
    this._chunks = [];
    this._speechTimer = 0;
    this._silenceTimer = 0;
    this._listenTimer = 0;
    this._setState("idle");
  }

  /** Start listening for speech. */
  start(): void {
    this.reset();
    this._setState("listening");
  }

  /**
   * Feed a VAD reading.  Call this every ~50ms with the latest RMS value.
   * @param rms — current RMS energy (0–255)
   * @param dt  — seconds since last feed (typically 0.05)
   * @param samples — optional Float32Array chunk to accumulate (from ScriptProcessorNode or AudioWorklet)
   */
  feed(rms: number, dt: number, samples?: Float32Array): void {
    if (this._state === "idle" || this._state === "done") return;

    const aboveThreshold = rms >= this._config.threshold;

    switch (this._state) {
      case "listening":
        this._listenTimer += dt;
        if (this._listenTimer >= this._config.maxWait) {
          this._setState("idle"); // timed out — no speech detected
          return;
        }
        if (aboveThreshold) {
          this._speechTimer += dt;
          if (this._speechTimer >= this._config.minSpeechDuration) {
            // Confirmed speech — start recording
            this._chunks = [];
            this._silenceTimer = 0;
            this._setState("recording");
          }
        } else {
          this._speechTimer = 0;
        }
        break;

      case "recording":
        if (samples) this._chunks.push(samples);
        if (!aboveThreshold) {
          this._silenceTimer += dt;
          if (this._silenceTimer >= this._config.silenceDuration) {
            this._setState("done");
            return;
          }
        } else {
          this._silenceTimer = 0;
        }
        break;
    }
  }

  /** Concatenate all recorded chunks into a single Float32Array. */
  getAudio(): Float32Array {
    let totalLen = 0;
    for (const c of this._chunks) totalLen += c.length;
    const result = new Float32Array(totalLen);
    let offset = 0;
    for (const c of this._chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result;
  }

  /** Encode recorded audio to base64 WAV. */
  getBase64Wav(): string | null {
    const audio = this.getAudio();
    if (audio.length === 0) return null;
    const wav = encodeWav(audio, this.sampleRate);
    return arrayBufferToBase64(wav);
  }

  private _setState(s: RecordState): void {
    this._state = s;
    this._onStateChange?.(s);
  }
}
