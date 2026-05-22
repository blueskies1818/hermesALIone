import { useRef, useState, useCallback, useEffect } from "react";
import { computeRms } from "@renderer/utils/audioCapture";
import { AudioPlayback } from "@renderer/utils/audioPlayback";

// ---------------------------------------------------------------------------
// Voice session states
// ---------------------------------------------------------------------------

export type VoiceState =
  | "idle"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

export interface VoiceSession {
  state: VoiceState;
  transcript: string;
  error: string;
}

export interface VoiceMessage {
  id: string;
  role: "user" | "agent";
  content: string;
}

// ---------------------------------------------------------------------------
// VAD constants (mirrors voice_mode.py)
// ---------------------------------------------------------------------------

const VAD_POLL_MS = 50;
const SILENCE_THRESHOLD = 25; // RMS 0-255
const MIN_SPEECH_SEC = 0.3;
const SILENCE_SEC = 2.0;
const MAX_WAIT_SEC = 15.0;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceMode(
  analyserRef: React.RefObject<AnalyserNode | null>,
  dataArrayRef: React.RefObject<Uint8Array | null>,
  streamRef: React.RefObject<MediaStream | null>,
) {
  const [session, setSession] = useState<VoiceSession>({
    state: "idle",
    transcript: "",
    error: "",
  });

  const [messages, setMessages] = useState<VoiceMessage[]>([]);

  const playbackRef = useRef<AudioPlayback | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const sessionRef = useRef<VoiceState>("idle");

  // VAD timers (seconds)
  const speechTimerRef = useRef(0);
  const silenceTimerRef = useRef(0);
  const listenTimerRef = useRef(0);
  const vadStopRequestedRef = useRef(false);

  // ------------------------------------------------------------------
  // State helpers
  // ------------------------------------------------------------------

  const setVoiceState = useCallback(
    (state: VoiceState, error = "") => {
      sessionRef.current = state;
      setSession((prev) => {
        if (state === "thinking" || state === "speaking") {
          return { state, transcript: prev.transcript, error };
        }
        if (state === "idle") {
          return { state, transcript: "", error };
        }
        return { ...prev, state, error };
      });
    },
    [],
  );

  // ------------------------------------------------------------------
  // MediaRecorder helpers
  // ------------------------------------------------------------------

  const startMediaRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    audioChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.start(100);
    mediaRecorderRef.current = recorder;
  }, [streamRef]);

  const stopMediaRecorder = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob(audioChunksRef.current));
        return;
      }
      recorder.onstop = () => {
        resolve(new Blob(audioChunksRef.current));
      };
      recorder.stop();
    });
  }, []);

  // ------------------------------------------------------------------
  // Handle completed recording blob — must be defined before vadTick
  // ------------------------------------------------------------------

  const handleBlob = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        setVoiceState("error", "Recording produced no audio data.");
        return;
      }

      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      try {
        const result = await window.hermesAPI.sendAudio(base64);
        if (result.success && result.transcript) {
          setSession((prev) => ({ ...prev, transcript: result.transcript }));
          setMessages((prev) => [
            ...prev,
            { id: `user-${Date.now()}`, role: "user", content: result.transcript },
          ]);
          setVoiceState("thinking");
        } else {
          setVoiceState(
            "error",
            result.error || "Transcription failed with no error message.",
          );
        }
      } catch (err) {
        setVoiceState(
          "error",
          `Transcription request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [setVoiceState],
  );

  // ------------------------------------------------------------------
  // VAD timer management
  // ------------------------------------------------------------------

  const stopVadInternal = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    speechTimerRef.current = 0;
    silenceTimerRef.current = 0;
    listenTimerRef.current = 0;
  }, []);

  // ------------------------------------------------------------------
  // VAD state machine — runs every VAD_POLL_MS via setInterval
  // ------------------------------------------------------------------

  const vadTick = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    if (!analyser || !dataArray) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    analyser.getByteTimeDomainData(dataArray as any);
    const rms = computeRms(dataArray);
    const aboveThreshold = rms >= SILENCE_THRESHOLD;
    const dt = VAD_POLL_MS / 1000;

    const currentState = sessionRef.current;

    if (vadStopRequestedRef.current) {
      stopVadInternal();
      vadStopRequestedRef.current = false;
      return;
    }

    if (currentState !== "listening" && currentState !== "recording") return;

    if (currentState === "listening") {
      listenTimerRef.current += dt;
      if (listenTimerRef.current >= MAX_WAIT_SEC) {
        setVoiceState("idle");
        vadStopRequestedRef.current = true;
        return;
      }
      if (aboveThreshold) {
        speechTimerRef.current += dt;
        if (speechTimerRef.current >= MIN_SPEECH_SEC) {
          silenceTimerRef.current = 0;
          startMediaRecorder();
          setVoiceState("recording");
        }
      } else {
        speechTimerRef.current = 0;
      }
      return;
    }

    // Recording
    if (!aboveThreshold) {
      silenceTimerRef.current += dt;
      if (silenceTimerRef.current >= SILENCE_SEC) {
        setVoiceState("transcribing");
        vadStopRequestedRef.current = true;
        stopMediaRecorder().then((blob) => {
          handleBlob(blob);
        });
      }
    } else {
      silenceTimerRef.current = 0;
    }
  }, [analyserRef, dataArrayRef, startMediaRecorder, stopMediaRecorder, handleBlob, setVoiceState, stopVadInternal]);

  // ------------------------------------------------------------------
  // Public VAD start
  // ------------------------------------------------------------------

  const startVad = useCallback(() => {
    if (vadTimerRef.current) return;
    speechTimerRef.current = 0;
    silenceTimerRef.current = 0;
    listenTimerRef.current = 0;
    vadStopRequestedRef.current = false;
    setVoiceState("listening");
    vadTimerRef.current = setInterval(vadTick, VAD_POLL_MS);
  }, [vadTick, setVoiceState]);

  // ------------------------------------------------------------------
  // TTS audio handler
  // ------------------------------------------------------------------

  const handleTtsAudio = useCallback(
    async (base64Chunk: string) => {
      const playback = playbackRef.current;
      if (!playback) return;

      if (sessionRef.current !== "speaking") {
        setVoiceState("speaking");
        speakingRef.current = true;
      }

      await playback.enqueue(base64Chunk);
    },
    [setVoiceState],
  );

  // ------------------------------------------------------------------
  // Public actions
  // ------------------------------------------------------------------

  const startListening = useCallback(() => {
    if (session.state !== "idle" && session.state !== "error") return;
    startVad();
  }, [session.state, startVad]);

  const stopAndTranscribe = useCallback(async () => {
    stopVadInternal();
    const blob = await stopMediaRecorder();
    handleBlob(blob);
  }, [stopVadInternal, stopMediaRecorder, handleBlob]);

  const interrupt = useCallback(() => {
    stopVadInternal();
    mediaRecorderRef.current?.stop();
    playbackRef.current?.stop();
    speakingRef.current = false;
    window.hermesAPI.abortChat();
    setVoiceState("idle");
  }, [stopVadInternal, setVoiceState]);

  const onAgentDone = useCallback(() => {
    speakingRef.current = false;
    setSession((prev) => {
      if (prev.state === "speaking" || prev.state === "thinking") {
        return { state: "idle", transcript: "", error: "" };
      }
      return prev;
    });
  }, []);

  const onAgentError = useCallback(
    (error: string) => {
      speakingRef.current = false;
      playbackRef.current?.stop();
      setVoiceState("error", error);
    },
    [setVoiceState],
  );

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  useEffect(() => {
    playbackRef.current = new AudioPlayback();

    // Capture text chunks so we can display agent responses alongside TTS audio.
    // Each new agent turn starts a fresh message on the first chunk.
    let agentMsgId = "";
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      if (!chunk.trim()) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "agent" && last.id === agentMsgId) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        agentMsgId = `agent-${Date.now()}`;
        return [
          ...prev,
          { id: agentMsgId, role: "agent", content: chunk },
        ];
      });
    });

    const cleanupTts = window.hermesAPI.onTtsAudio(handleTtsAudio);

    return () => {
      cleanupChunk();
      cleanupTts();
      stopVadInternal();
      playbackRef.current?.close();
    };
  }, [handleTtsAudio, stopVadInternal]);

  useEffect(() => {
    return () => {
      stopVadInternal();
    };
  }, [stopVadInternal]);

  return {
    session,
    messages,
    startListening,
    stopAndTranscribe,
    interrupt,
    onAgentDone,
    onAgentError,
  } as const;
}
