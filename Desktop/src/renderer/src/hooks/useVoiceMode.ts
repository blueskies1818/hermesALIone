import { useRef, useState, useCallback, useEffect, useReducer } from "react";
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

export interface TtsDebugInfo {
  chunksReceived: number;
  chunksPlayed: number;
  playbackState: string;
  lastError: string;
}

// ---------------------------------------------------------------------------
// VAD constants (mirrors voice_mode.py)
// ---------------------------------------------------------------------------

const VAD_POLL_MS = 50;
const SILENCE_THRESHOLD = 5; // RMS 0-255
const MIN_SPEECH_SEC = 0.3;
const SILENCE_SEC = 2.0;
const MAX_WAIT_SEC = 15.0;
// Number of 100ms chunks to keep before speech detection (~3 seconds of pre-roll)
const PRE_ROLL_CHUNKS = 30;

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
  const [ttsDebug, dispatchTts] = useReducer(
    (s: TtsDebugInfo, action: Partial<TtsDebugInfo>) => ({ ...s, ...action }),
    { chunksReceived: 0, chunksPlayed: 0, playbackState: "idle", lastError: "" },
  );

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

  // Pre-roll state: keep last PRE_ROLL_CHUNKS blobs before speech starts.
  // The first chunk always contains the WebM header so we never drop it.
  const preRollRef = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(false);

  const startMediaRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    audioChunksRef.current = [];
    preRollRef.current = [];
    recordingStartedRef.current = false;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      if (recordingStartedRef.current) {
        // Speech detected — accumulate normally
        audioChunksRef.current.push(e.data);
      } else {
        // Pre-roll: sliding window, always keep chunk[0] (has WebM header)
        preRollRef.current.push(e.data);
        if (preRollRef.current.length > PRE_ROLL_CHUNKS) {
          // Drop the second-oldest (keep index 0 which has the WebM header)
          preRollRef.current.splice(1, 1);
        }
      }
    };
    recorder.start(100);
    mediaRecorderRef.current = recorder;
  }, [streamRef]);

  const stopMediaRecorder = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const finish = () => {
        // Prepend pre-roll (WebM header chunk first, then recent pre-roll, then speech)
        const chunks = [...preRollRef.current, ...audioChunksRef.current];
        resolve(new Blob(chunks));
      };
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        finish();
        return;
      }
      recorder.onstop = finish;
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
        // Timed out — stop pre-roll recorder and go idle
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        setVoiceState("idle");
        vadStopRequestedRef.current = true;
        return;
      }
      if (aboveThreshold) {
        speechTimerRef.current += dt;
        if (speechTimerRef.current >= MIN_SPEECH_SEC) {
          silenceTimerRef.current = 0;
          // Flip to recording mode — MediaRecorder is already running for pre-roll
          recordingStartedRef.current = true;
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
    // Start recorder immediately so pre-roll accumulates while waiting for speech
    startMediaRecorder();
    setVoiceState("listening");
    vadTimerRef.current = setInterval(vadTick, VAD_POLL_MS);
  }, [vadTick, setVoiceState, startMediaRecorder]);

  // ------------------------------------------------------------------
  // TTS audio handler
  // ------------------------------------------------------------------

  const ttsChunksReceivedRef = useRef(0);
  const ttsChunksPlayedRef = useRef(0);

  const handleTtsAudio = useCallback(
    async (base64Chunk: string) => {
      console.log("[TTS] renderer received audio chunk, length:", base64Chunk.length, "playback ready:", !!playbackRef.current);
      ttsChunksReceivedRef.current += 1;
      dispatchTts({ chunksReceived: ttsChunksReceivedRef.current, playbackState: "enqueuing" });
      const playback = playbackRef.current;
      if (!playback) {
        dispatchTts({ lastError: "playbackRef is null" });
        return;
      }

      if (sessionRef.current !== "speaking") {
        setVoiceState("speaking");
        speakingRef.current = true;
      }

      try {
        await playback.enqueue(base64Chunk);
        ttsChunksPlayedRef.current += 1;
        dispatchTts({ chunksPlayed: ttsChunksPlayedRef.current, playbackState: playback.state });
      } catch (err) {
        dispatchTts({ lastError: String(err), playbackState: "error" });
      }
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
    ttsChunksReceivedRef.current = 0;
    ttsChunksPlayedRef.current = 0;
    dispatchTts({ chunksReceived: 0, chunksPlayed: 0, playbackState: "idle", lastError: "" });
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
    ttsPlaybackRef: playbackRef,
    ttsDebug,
  } as const;
}
