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
// VAD configuration (tunable, self-adjusting)
// ---------------------------------------------------------------------------

export interface VadConfig {
  pollMs: number;
  silenceThreshold: number;   // RMS 0-255
  minSpeechSec: number;       // sustained speech before recording
  silenceSec: number;         // sustained silence before transcribing
  maxListenSec: number;       // give up if no speech this long
  interruptSpeechSec: number; // sustained speech during agent to trigger interrupt
  ambientAdaptRate: number;   // how fast noise floor adapts (0-1, lower=slower)
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  pollMs: 50,
  silenceThreshold: 25,
  minSpeechSec: 0.3,
  silenceSec: 1.5,
  maxListenSec: 60,
  interruptSpeechSec: 0.4,
  ambientAdaptRate: 0.01,
};

// ---------------------------------------------------------------------------
// Wake-word / smart-transcript detection
// ---------------------------------------------------------------------------

const WAKE_PHRASES = ["hermes", "hermes,", "hey hermes", "ok hermes"];
const QUESTION_LEADERS = [
  "why", "how", "what", "who", "where", "when",
  "can you", "could you", "would you", "will you",
  "tell me", "explain", "describe", "show me",
  "find", "search", "look up", "check",
  "i need", "i want", "please", "help",
  "do you", "does this", "is there", "are you",
  "which", "define", "summarize",
];

function isMeaningfulTranscript(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (lower.length < 4) return false;

  for (const phrase of WAKE_PHRASES) {
    if (lower.startsWith(phrase)) return true;
  }

  for (const leader of QUESTION_LEADERS) {
    if (lower.startsWith(leader)) return true;
  }

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length >= 5) return true;
  if (words.length >= 3 && /[.?!]$/.test(lower)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Interrupt command detection
// ---------------------------------------------------------------------------

const INTERRUPT_PATTERNS = [
  "stop", "hang on", "wait", "pause", "shut up",
  "be quiet", "quiet", "hold on", "hold up",
  "never mind", "nevermind", "cancel",
];

function isInterruptCommand(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return INTERRUPT_PATTERNS.some((p) => lower.includes(p));
}

// ---------------------------------------------------------------------------
// Voice system prompt builder
// ---------------------------------------------------------------------------

export function buildVoiceSystemPrompt(
  conversationHistory?: VoiceMessage[],
): string {
  let prompt =
    `You are Hermes, a general-purpose AI orchestrator with broad knowledge across many domains. You communicate via voice — be concise, conversational, and direct. Keep responses to 2-4 sentences for simple answers. No markdown, no code blocks, no long explanations. If you need to reference code, describe it briefly.

You have access to tools for file operations, web search, code execution, and more. Use them when needed but don't over-explain what you're doing. You're having a natural voice conversation — respond like a knowledgeable colleague, not a documentation page.`;

  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-6);
    const lines = recent.map(
      (m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`,
    );
    prompt += `\n\nRecent conversation:\n${lines.join("\n")}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceMode(
  analyserRef: React.RefObject<AnalyserNode | null>,
  dataArrayRef: React.RefObject<Uint8Array | null>,
  streamRef: React.RefObject<MediaStream | null>,
  vadConfigOverrides?: Partial<VadConfig>,
) {
  const cfg: VadConfig = { ...DEFAULT_VAD_CONFIG, ...vadConfigOverrides };

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
  const sessionRef = useRef<VoiceState>("idle");

  // VAD timers (seconds)
  const speechTimerRef = useRef(0);
  const silenceTimerRef = useRef(0);
  const listenTimerRef = useRef(0);
  const interruptSpeechTimerRef = useRef(0);
  const vadStopRequestedRef = useRef(false);

  // Ambient noise floor adaptation
  const ambientFloorRef = useRef(cfg.silenceThreshold);

  // Refs for functions that have circular dependencies with handleBlob
  const startVadRef = useRef<() => void>(() => {});
  const interruptRef = useRef<() => void>(() => {});

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
        if (state === "idle" || state === "listening") {
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
  // Handle completed recording blob
  // ------------------------------------------------------------------

  const handleBlob = useCallback(
    async (blob: Blob, isInterruptSample = false) => {
      if (blob.size === 0) {
        if (!isInterruptSample) {
          setVoiceState("error", "Recording produced no audio data.");
        }
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
          const transcript = result.transcript.trim();

          // Interrupt sample: check for stop commands
          if (isInterruptSample) {
            if (isInterruptCommand(transcript)) {
              interruptRef.current();
            }
            return;
          }

          // Normal flow: check if transcript is meaningful
          if (!isMeaningfulTranscript(transcript)) {
            setVoiceState("listening");
            startVadRef.current();
            return;
          }

          setSession((prev) => ({ ...prev, transcript }));
          setMessages((prev) => [
            ...prev,
            { id: `user-${Date.now()}`, role: "user", content: transcript },
          ]);
          setVoiceState("thinking");
        } else if (!isInterruptSample) {
          setVoiceState(
            "error",
            result.error || "Transcription failed with no error message.",
          );
        }
      } catch (err) {
        if (!isInterruptSample) {
          setVoiceState(
            "error",
            `Transcription request failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
    interruptSpeechTimerRef.current = 0;
  }, []);

  // ------------------------------------------------------------------
  // VAD state machine — runs every pollMs via setInterval
  // ------------------------------------------------------------------

  const vadTick = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    if (!analyser || !dataArray) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    analyser.getByteTimeDomainData(dataArray as any);
    const rms = computeRms(dataArray);

    // Adapt ambient noise floor
    const prevFloor = ambientFloorRef.current;
    ambientFloorRef.current =
      (1 - cfg.ambientAdaptRate) * prevFloor +
      cfg.ambientAdaptRate * rms;

    const effectiveThreshold = Math.max(
      cfg.silenceThreshold,
      ambientFloorRef.current * 1.5,
    );

    const aboveThreshold = rms >= effectiveThreshold;
    const dt = cfg.pollMs / 1000;

    const currentState = sessionRef.current;

    if (vadStopRequestedRef.current) {
      stopVadInternal();
      vadStopRequestedRef.current = false;
      return;
    }

    // ── Interrupt detection while agent is speaking/thinking ──
    if (currentState === "speaking" || currentState === "thinking") {
      if (aboveThreshold) {
        interruptSpeechTimerRef.current += dt;
        if (interruptSpeechTimerRef.current >= cfg.interruptSpeechSec) {
          interruptRef.current();
        }
      } else {
        interruptSpeechTimerRef.current = Math.max(
          0,
          interruptSpeechTimerRef.current - dt,
        );
      }
      return;
    }

    if (currentState !== "listening" && currentState !== "recording") return;

    // ── Listening state ──
    if (currentState === "listening") {
      listenTimerRef.current += dt;
      if (listenTimerRef.current >= cfg.maxListenSec) {
        listenTimerRef.current = 0;
        return;
      }
      if (aboveThreshold) {
        speechTimerRef.current += dt;
        if (speechTimerRef.current >= cfg.minSpeechSec) {
          silenceTimerRef.current = 0;
          startMediaRecorder();
          setVoiceState("recording");
        }
      } else {
        speechTimerRef.current = Math.max(0, speechTimerRef.current - dt * 2);
      }
      return;
    }

    // ── Recording state ──
    if (!aboveThreshold) {
      silenceTimerRef.current += dt;
      if (silenceTimerRef.current >= cfg.silenceSec) {
        setVoiceState("transcribing");
        vadStopRequestedRef.current = true;
        stopMediaRecorder().then((blob) => {
          handleBlob(blob);
        });
      }
    } else {
      silenceTimerRef.current = 0;
    }
  }, [
    analyserRef, dataArrayRef, cfg, startMediaRecorder,
    stopMediaRecorder, handleBlob, setVoiceState, stopVadInternal,
  ]);

  // ------------------------------------------------------------------
  // Public VAD start
  // ------------------------------------------------------------------

  const startVad = useCallback(() => {
    if (vadTimerRef.current) return;
    speechTimerRef.current = 0;
    silenceTimerRef.current = 0;
    listenTimerRef.current = 0;
    interruptSpeechTimerRef.current = 0;
    vadStopRequestedRef.current = false;
    setVoiceState("listening");
    vadTimerRef.current = setInterval(vadTick, cfg.pollMs);
  }, [vadTick, setVoiceState, cfg.pollMs]);

  startVadRef.current = startVad;

  // ------------------------------------------------------------------
  // TTS audio handler
  // ------------------------------------------------------------------

  const handleTtsAudio = useCallback(
    async (base64Chunk: string) => {
      const playback = playbackRef.current;
      if (!playback) return;

      if (sessionRef.current !== "speaking") {
        setVoiceState("speaking");
      }

      await playback.enqueue(base64Chunk);
    },
    [setVoiceState],
  );

  // ------------------------------------------------------------------
  // Public actions
  // ------------------------------------------------------------------

  const startListening = useCallback(() => {
    const s = sessionRef.current;
    if (s !== "idle" && s !== "error") return;
    startVad();
  }, [startVad]);

  const stopAndTranscribe = useCallback(async () => {
    stopVadInternal();
    const blob = await stopMediaRecorder();
    handleBlob(blob);
  }, [stopVadInternal, stopMediaRecorder, handleBlob]);

  const interrupt = useCallback(() => {
    stopVadInternal();
    mediaRecorderRef.current?.stop();
    playbackRef.current?.stop();
    window.hermesAPI.abortChat();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "agent") {
        return prev.slice(0, -1);
      }
      return prev;
    });
    setVoiceState("idle");
    // Auto-restart listening after interrupt
    setTimeout(() => {
      const s = sessionRef.current;
      if (s === "idle" || s === "error") return;
      startVad();
    }, 300);
  }, [stopVadInternal, setVoiceState, startVad]);

  interruptRef.current = interrupt;

  const onAgentDone = useCallback(() => {
    setSession((prev) => {
      if (prev.state === "speaking" || prev.state === "thinking") {
        return { state: "idle", transcript: "", error: "" };
      }
      return prev;
    });
    // Auto-restart listening for continuous conversation
    setTimeout(() => startVad(), 500);
  }, [startVad]);

  const onAgentError = useCallback(
    (error: string) => {
      playbackRef.current?.stop();
      setVoiceState("error", error);
      // Auto-restart listening after error
      setTimeout(() => {
        if (sessionRef.current === "error") {
          startVad();
        }
      }, 2000);
    },
    [setVoiceState, startVad],
  );

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  useEffect(() => {
    playbackRef.current = new AudioPlayback();

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
