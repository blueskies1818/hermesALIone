/**
 * Sequential audio chunk playback using HTMLAudioElement + Blob URLs.
 *
 * Accepts base64-encoded MP3 chunks, converts them to Blob URLs, and plays
 * them sequentially in order. Uses the HTML Audio element which has no
 * AudioContext autoplay policy restrictions in Electron.
 *
 * An optional Web Audio API analyser is created for the visualizer but is
 * not required for playback.
 */

type PlayState = "idle" | "playing" | "paused" | "stopped";

interface QueuedChunk {
  url: string;
  index: number;
}

export class AudioPlayback {
  private _ctx: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _state: PlayState = "idle";
  private _queue: QueuedChunk[] = [];
  private _nextIndex = 0;
  private _currentAudio: HTMLAudioElement | null = null;
  private _onStateChange?: (state: PlayState) => void;
  private _onEnd?: () => void;

  /**
   * Pre-initialize the Web Audio analyser (for visualizer only, optional).
   * Safe to call from a user gesture or without one (analyser is not used
   * for actual playback so AudioContext suspension doesn't block audio).
   */
  ensureContext(): AudioContext {
    if (!this._ctx || this._ctx.state === "closed") {
      this._ctx = new AudioContext();
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 512;
      this._analyser.connect(this._ctx.destination);
    }
    if (this._ctx.state === "suspended") {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  }

  /** Fill `out` with frequency-domain data for visualization (0–255 per bin). */
  getFrequencyData(out: Uint8Array<ArrayBuffer>): void {
    if (this._analyser) {
      this._analyser.getByteFrequencyData(out);
    } else {
      out.fill(0);
    }
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
   * Decode a base64 audio chunk and enqueue it for sequential playback.
   * Uses HTMLAudioElement + Blob URL — no AudioContext required for playback.
   */
  async enqueue(base64Chunk: string, index?: number): Promise<void> {
    const binary = atob(base64Chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const chunkIndex = index ?? this._nextIndex++;
    this._queue.push({ url, index: chunkIndex });
    this._queue.sort((a, b) => a.index - b.index);

    console.log("[AudioPlayback] enqueued chunk", chunkIndex, "queue size:", this._queue.length, "state:", this._state);

    if (this._state !== "playing") {
      this._playNext();
    }
  }

  /** Stop playback, revoke all pending blob URLs, and clear the queue. */
  stop(): void {
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio.src = "";
      this._currentAudio = null;
    }
    for (const { url } of this._queue) URL.revokeObjectURL(url);
    this._queue = [];
    this._nextIndex = 0;
    this._setState("stopped");
  }

  /** Pause current playback (keeps queue). */
  pause(): void {
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio = null;
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
    this._analyser?.disconnect();
    this._analyser = null;
    if (this._ctx && this._ctx.state !== "closed") {
      this._ctx.close().catch(() => {});
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

    const { url } = this._queue.shift()!;
    const audio = new Audio(url);
    this._currentAudio = audio;
    // Set state synchronously so concurrent enqueue() calls don't start a second _playNext().
    this._setState("playing");

    audio.onended = () => {
      URL.revokeObjectURL(url);
      this._currentAudio = null;
      this._playNext();
    };

    audio.onerror = (e) => {
      console.error("[AudioPlayback] audio element error:", e);
      URL.revokeObjectURL(url);
      this._currentAudio = null;
      this._playNext();
    };

    console.log("[AudioPlayback] calling audio.play()");

    audio.play()
      .then(() => {
        console.log("[AudioPlayback] audio.play() started OK");
      })
      .catch((err) => {
        console.error("[AudioPlayback] audio.play() rejected:", err);
        URL.revokeObjectURL(url);
        this._currentAudio = null;
        this._setState("idle");
        this._playNext();
      });
  }

  private _setState(s: PlayState): void {
    this._state = s;
    this._onStateChange?.(s);
  }
}
