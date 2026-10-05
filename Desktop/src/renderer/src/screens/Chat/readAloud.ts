import { useSyncExternalStore } from "react";
import { AudioPlayback } from "../../utils/audioPlayback";

/**
 * Theta: read one chat message aloud at a time. Audio is synthesised on the
 * server (POST /v1/tts) and played here; starting another message, or
 * pressing stop, cancels the current one.
 */
export interface ReadAloudState {
  id: string | null;
  phase: "idle" | "loading" | "playing";
  error: string | null;
}

let state: ReadAloudState = { id: null, phase: "idle", error: null };
const listeners = new Set<() => void>();
let player: AudioPlayback | null = null;
let generation = 0;

function set(next: ReadAloudState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function stopReading(): void {
  generation++;
  player?.stop();
  if (state.phase !== "idle") set({ id: null, phase: "idle", error: null });
}

export async function readAloud(id: string, text: string): Promise<void> {
  stopReading();
  const mine = generation;
  set({ id, phase: "loading", error: null });
  const result = await window.hermesAPI.speakText(text).catch(() => null);
  if (mine !== generation) return;
  if (!result?.success || !result.chunks?.length) {
    set({ id, phase: "idle", error: result?.error || "Read aloud failed" });
    return;
  }
  if (!player) player = new AudioPlayback();
  player.onEnd = () => {
    if (mine === generation) set({ id: null, phase: "idle", error: null });
  };
  set({ id, phase: "playing", error: null });
  result.chunks.forEach((chunk, i) => player!.enqueue(chunk, i));
}

export function useReadAloud(): ReadAloudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
