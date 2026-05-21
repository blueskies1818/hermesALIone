import { useEffect, useRef, useState, useCallback } from "react";
import { useVoiceMode } from "../../hooks/useVoiceMode";
import ModelSelector from "../../components/ModelSelector";

type MicState = "idle" | "checking" | "listening" | "error";

interface AssistantProps {
  profile?: string;
}

function Assistant({ profile = "default" }: AssistantProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const idleTimeRef = useRef<number>(0);
  const [micState, setMicState] = useState<MicState>("idle");
  const [micError, setMicError] = useState("");
  const [modelConfig, setModelConfig] = useState({
    provider: "",
    model: "",
    baseUrl: "",
  });

  // Load current model config
  useEffect(() => {
    window.hermesAPI.getModelConfig(profile).then(setModelConfig).catch(() => {});
  }, [profile]);

  const handleModelSelect = useCallback(
    (provider: string, model: string, baseUrl: string) => {
      setModelConfig({ provider, model, baseUrl });
      window.hermesAPI.setModelConfig(provider, model, baseUrl, profile);
    },
    [profile],
  );

  const {
    session: voiceSession,
    startListening,
    stopAndTranscribe,
    interrupt,
    onAgentDone,
    onAgentError,
  } = useVoiceMode(analyserRef, dataArrayRef, streamRef);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const baseRadius = 80;
    const len = analyser ? (dataArray ? dataArray.length : 256) : 256;

    // Use real mic data if available, otherwise generate synthetic idle wave
    if (analyser && dataArray) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      analyser.getByteFrequencyData(dataArray as any);
    } else {
      idleTimeRef.current += 0.016;
      const t = idleTimeRef.current;
      if (!dataArrayRef.current) {
        dataArrayRef.current = new Uint8Array(len);
      }
      const arr = dataArrayRef.current;
      for (let i = 0; i < len; i++) {
        const angle = (i / len) * Math.PI * 2;
        const wave = Math.sin(angle * 3 + t * 0.7) * 0.5 + 0.5;
        const pulse = Math.sin(t * 1.3) * 0.5 + 0.5;
        arr[i] = Math.floor((wave * pulse * 30 + 5) * (0.7 + pulse * 0.3));
      }
    }

    const cs = getComputedStyle(canvas);
    const bg = cs.getPropertyValue("--bg-primary").trim() || "#12131c";

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const arr = dataArrayRef.current!;

    // Continuous filled ribbon — outer edge follows the wave, inner edge at base radius
    const gradient = ctx.createRadialGradient(cx, cy, baseRadius, cx, cy, baseRadius + 100);
    gradient.addColorStop(0, "#00ffcc");
    gradient.addColorStop(0.5, "#00ffcc");
    gradient.addColorStop(1, "#ff007f");

    ctx.beginPath();
    for (let i = 0; i <= len; i++) {
      const idx = i % len;
      const angle = (idx / len) * Math.PI * 2;
      const barHeight = arr[idx] * 0.6;
      const x = cx + Math.cos(angle) * (baseRadius + barHeight);
      const y = cy + Math.sin(angle) * (baseRadius + barHeight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = len; i >= 0; i--) {
      const idx = i % len;
      const angle = (idx / len) * Math.PI * 2;
      const x = cx + Math.cos(angle) * baseRadius;
      const y = cy + Math.sin(angle) * baseRadius;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,255,204,0.4)";
    ctx.stroke();

    // Center pulse circle
    let sum = 0;
    for (let i = 0; i < len; i++) sum += arr[i];
    const avg = sum / len;

    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius - 5 + avg * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // Start passive idle animation immediately
  useEffect(() => {
    idleTimeRef.current = performance.now() / 1000;
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ------------------------------------------------------------------
  // Microphone setup — called on first click
  // ------------------------------------------------------------------

  const startAudio = useCallback(async () => {
    if (audioCtxRef.current) {
      // Mic already set up — start listening
      startListening();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicState("error");
      setMicError(
        "Microphone not available — navigator.mediaDevices missing. " +
          "This Electron app may need the --enable-media-stream flag.",
      );
      return;
    }

    setMicState("checking");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      streamRef.current = stream;

      const audioCtx = new (window.AudioContext ||
        (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      const bufferLength = analyser.frequencyBinCount;
      source.connect(analyser);

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(bufferLength);

      setMicState("listening");
      // Auto-start listening once mic is ready
      startListening();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "Unknown";
      const message = err instanceof Error ? err.message : String(err);
      setMicState("error");
      if (name === "NotAllowedError") {
        setMicError("Microphone access denied. Grant permission in your browser/OS settings and reload.");
      } else if (name === "NotFoundError") {
        setMicError(
          "No microphone found. Plug in a microphone or check PulseAudio/PipeWire is running.\n\n" +
            "Linux: try 'pactl list sources short' to see available devices.\n" +
            `Details: ${message}`,
        );
      } else if (name === "NotReadableError") {
        setMicError(
          "Microphone is in use by another app or not readable. Close other apps using the mic and try again.\n\n" +
            `Details: ${message}`,
        );
      } else {
        setMicError(`Could not access microphone (${name}): ${message}`);
      }
    }
  }, [startListening]);

  // ------------------------------------------------------------------
  // When transcript is ready, send it to the agent via chat pipeline
  // ------------------------------------------------------------------

  useEffect(() => {
    if (voiceSession.state === "thinking" && voiceSession.transcript) {
      window.hermesAPI.sendMessage(voiceSession.transcript, profile);
    }
  }, [voiceSession.state, voiceSession.transcript, profile]);

  // ------------------------------------------------------------------
  // Wire IPC events to voice mode callbacks
  // ------------------------------------------------------------------

  useEffect(() => {
    const cleanupDone = window.hermesAPI.onChatDone(() => {
      onAgentDone();
    });
    const cleanupError = window.hermesAPI.onChatError((error: string) => {
      onAgentError(error);
    });
    return () => {
      cleanupDone();
      cleanupError();
    };
  }, [onAgentDone, onAgentError]);

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  // ------------------------------------------------------------------
  // Derived UI state
  // ------------------------------------------------------------------

  const voiceState = voiceSession.state;

  const hintText = ((): string | undefined => {
    if (micState === "checking") return "Requesting microphone access...";
    if (micState === "error") return micError || "Microphone error";
    switch (voiceState) {
      case "listening": return "Listening...";
      case "recording": return "Recording...";
      case "transcribing": return "Transcribing...";
      case "thinking": return "Processing...";
      case "speaking": return "Speaking...";
      case "error": return voiceSession.error;
    }
    if (micState === "idle") return "Click anywhere to enable voice assistant";
    return undefined;
  })();

  const clickHandler = ((): (() => void) | undefined => {
    if (micState === "idle") return startAudio;
    if (micState === "error") return startAudio;
    if (voiceState === "idle") return startListening;
    if (voiceState === "speaking" || voiceState === "thinking" ||
        voiceState === "recording" || voiceState === "listening") {
      return interrupt;
    }
    return undefined;
  })();

  return (
    <div
      className="assistant-visualizer"
      onClick={clickHandler}
      style={{ cursor: clickHandler ? "pointer" : undefined }}
    >
      <ModelSelector
        profile={profile}
        currentModel={modelConfig.model}
        currentProvider={modelConfig.provider}
        currentBaseUrl={modelConfig.baseUrl}
        onSelect={handleModelSelect}
      />

      <canvas ref={canvasRef} width={500} height={500} />

      {hintText && (
        <div className={`assistant-mic-hint ${voiceState === "error" ? "assistant-mic-error" : ""}`}>
          {hintText}
        </div>
      )}

      {/* Voice state indicator dot */}
      {voiceState !== "idle" && voiceState !== "error" && (
        <div className="assistant-voice-state">
          <span className={`assistant-voice-dot assistant-voice-dot-${voiceState}`} />
          <span className="assistant-voice-label">
            {voiceState === "listening" ? "Listening for speech" :
             voiceState === "recording" ? "Recording" :
             voiceState === "transcribing" ? "Transcribing audio" :
             voiceState === "thinking" ? "Agent thinking" :
             voiceState === "speaking" ? "Agent speaking" : ""}
          </span>
        </div>
      )}

      {/* PTT buttons */}
      {micState !== "idle" && micState !== "checking" && micState !== "error" && (
        <div className="assistant-controls">
          {voiceState === "idle" && (
            <button className="assistant-btn" onClick={startListening}>
              Start Listening
            </button>
          )}
          {voiceState === "recording" && (
            <button className="assistant-btn" onClick={stopAndTranscribe}>
              Stop & Transcribe
            </button>
          )}
          {(voiceState === "thinking" || voiceState === "speaking") && (
            <button className="assistant-btn assistant-btn-danger" onClick={interrupt}>
              Interrupt
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default Assistant;
