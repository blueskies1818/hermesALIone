/**
 * Sequential audio chunk playback via Web Audio API.
 *
 * Accepts base64-encoded audio chunks (MP3, WAV, or any format the browser's
 * decodeAudioData supports), decodes them, and plays them in order with
 * minimal gaps between chunks.
 */

type PlayState = "idle" | "playing" | "paused" | "stopped";

interface QueuedChunk {
  buffer: AudioBuffer;
  index: number;
}

export class AudioPlayback {
  private _ctx: AudioContext | null = null;
  private _state: PlayState = "idle";
  private _queue: QueuedChunk[] = [];
  private _nextIndex = 0;
  private _currentSource: AudioBufferSourceNode | null = null;
  private _onStateChange?: (state: PlayState) => void;
  private _onEnd?: () => void;

  /** Ensure an AudioContext exists (must be called from a user gesture). */
  ensureContext(): AudioContext {
    if (!this._ctx || this._ctx.state === "closed") {
      this._ctx = new AudioContext();
    }
    if (this._ctx.state === "suspended") {
      this._ctx.resume();
    }
    return this._ctx;
  }

  get state(): PlayState {
    return this._state;
  }

  set onStateChange(cb: ((state: PlayState) => void) | undefined) {
    this._onStateChange = cb;
  }

  set onEnd(cb: (() => void) | undefined) {
    this._onEnd = cb;
  }

  /**
   * Decode a base64 audio chunk and enqueue it for playback.
   * Chunks play sequentially in the order they are enqueued.
   */
  async enqueue(base64Chunk: string, index?: number): Promise<void> {
    const ctx = this.ensureContext();

    const binary = atob(base64Chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    try {
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      this._queue.push({ buffer: audioBuffer, index: index ?? this._nextIndex++ });
      this._queue.sort((a, b) => a.index - b.index);

      if (this._state !== "playing") {
        this._playNext();
      }
    } catch (err) {
      console.warn("Failed to decode audio chunk:", err);
    }
  }

  /** Stop playback and clear the queue. */
  stop(): void {
    if (this._currentSource) {
      try {
        this._currentSource.stop();
      } catch {
        // Already stopped
      }
      this._currentSource = null;
    }
    this._queue = [];
    this._nextIndex = 0;
    this._setState("stopped");
  }

  /** Pause (stops current source, keeps queue). */
  pause(): void {
    if (this._currentSource) {
      try {
        this._currentSource.stop();
      } catch {
        // Already stopped
      }
      this._currentSource = null;
    }
    this._setState("paused");
  }

  /** Resume after pause. */
  resume(): void {
    if (this._state === "paused" && this._queue.length > 0) {
      this._playNext();
    }
  }

  close(): void {
    this.stop();
    if (this._ctx && this._ctx.state !== "closed") {
      this._ctx.close();
    }
    this._ctx = null;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private _playNext(): void {
    if (this._queue.length === 0) {
      this._setState("idle");
      this._onEnd?.();
      return;
    }

    const ctx = this._ctx;
    if (!ctx || ctx.state === "closed") return;

    const { buffer } = this._queue.shift()!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      this._currentSource = null;
      this._playNext();
    };

    this._currentSource = source;
    source.start();
    this._setState("playing");
  }

  private _setState(s: PlayState): void {
    this._state = s;
    this._onStateChange?.(s);
  }
}
