import { useCallback, useEffect, useRef, useState } from "react";
import { arrayBufferToBase64, encodeWav } from "../../../utils/audioCapture";

export type DictationPhase = "idle" | "recording" | "transcribing";

interface Capture {
  stream: MediaStream;
  ctx: AudioContext;
  node: ScriptProcessorNode;
  chunks: Float32Array[];
}

/**
 * Theta: click-to-talk dictation for the chat input. Records the mic until
 * stopped, then transcribes on the server (POST /v1/transcribe) and hands
 * the text to `onText`.
 */
export function useDictation(onText: (text: string) => void): {
  phase: DictationPhase;
  error: string | null;
  toggle: () => void;
} {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const capture = useRef<Capture | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const release = useCallback((): Capture | null => {
    const c = capture.current;
    capture.current = null;
    if (!c) return null;
    c.node.disconnect();
    c.stream.getTracks().forEach((track) => track.stop());
    c.ctx.close().catch(() => {});
    return c;
  }, []);

  useEffect(() => () => void release(), [release]);

  const start = async (): Promise<void> => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(node);
      node.connect(ctx.destination);
      capture.current = { stream, ctx, node, chunks };
      setPhase("recording");
    } catch {
      setError("Microphone is not available");
    }
  };

  const finish = async (): Promise<void> => {
    const c = release();
    if (!c) return;
    const total = c.chunks.reduce((n, a) => n + a.length, 0);
    if (total < c.ctx.sampleRate * 0.3) { setPhase("idle"); return; }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const a of c.chunks) { samples.set(a, offset); offset += a.length; }
    setPhase("transcribing");
    const wav = arrayBufferToBase64(encodeWav(samples, c.ctx.sampleRate));
    const result = await window.hermesAPI.sendAudio(wav).catch(() => null);
    setPhase("idle");
    if (result?.success && result.transcript.trim()) onTextRef.current(result.transcript.trim());
    else setError(result?.error || "Could not transcribe");
  };

  const toggle = (): void => {
    if (phase === "recording") void finish();
    else if (phase === "idle") void start();
  };

  return { phase, error, toggle };
}
