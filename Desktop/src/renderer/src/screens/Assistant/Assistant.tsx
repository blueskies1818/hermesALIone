import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { useVoiceMode } from "@renderer/hooks/useVoiceMode";
import ModelSelector from "@renderer/components/ModelSelector";

type MicState = "idle" | "checking" | "listening" | "error";

interface AssistantProps {
  profile?: string;
}

function Assistant({ profile = "default" }: AssistantProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  // Normalization state — exponential smoothing + decaying peak tracker
  const smoothedRef = useRef<Float32Array | null>(null);
  const peakRef = useRef<number>(30);
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
    messages,
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
    const baseRadius = 95;
    const len = analyser ? (dataArray ? dataArray.length : 256) : 256;
    // Only the first half of frequency bins carry meaningful voice content.
    // We mirror them back around the circle so the whole ring stays active.
    const halfLen = Math.floor(len / 2);

    // Read mic data when available; otherwise leave array zeroed (no passive animation).
    if (analyser && dataArray) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      analyser.getByteFrequencyData(dataArray as any);
    } else if (!dataArrayRef.current) {
      dataArrayRef.current = new Uint8Array(len);
    }

    const rawArr = dataArrayRef.current!;

    // Exponential smoothing + decaying-peak normalization (first half only)
    if (!smoothedRef.current || smoothedRef.current.length !== len) {
      smoothedRef.current = new Float32Array(len);
    }
    const smoothed = smoothedRef.current;
    const SMOOTH = 0.65;
    // Noise floor cuts DC bias / mic hiss so silent bins render as flat zero
    const NOISE_FLOOR = 10;
    let maxVal = 0;
    for (let i = 0; i <= halfLen; i++) {
      smoothed[i] = SMOOTH * smoothed[i] + (1 - SMOOTH) * rawArr[i];
      if (smoothed[i] > maxVal) maxVal = smoothed[i];
    }
    peakRef.current = Math.max(peakRef.current * 0.992, Math.max(maxVal, 20));
    const normFactor = 60 / peakRef.current;

    const cs = getComputedStyle(canvas);
    const bg = cs.getPropertyValue("--bg-primary").trim() || "#12131c";

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Continuous filled ribbon — outer edge follows the mirrored wave, inner edge at base radius.
    // Mirroring: first half traverses bins 0→halfLen, second half mirrors halfLen→0.
    // Both endpoints land on bin 0, guaranteeing a seamless join with no hard cutoff.
    // Start angle at -π/2 so the peak sits at 12 o'clock.
    const gradient = ctx.createRadialGradient(cx, cy, baseRadius, cx, cy, baseRadius + 120);
    gradient.addColorStop(0, "#00ffcc");
    gradient.addColorStop(0.5, "#00ffcc");
    gradient.addColorStop(1, "#ff007f");

    ctx.beginPath();
    for (let i = 0; i <= len; i++) {
      const idx = i % len;
      const angle = (idx / len) * Math.PI * 2 - Math.PI / 2;
      const bin = idx <= halfLen ? idx : len - idx;
      const barHeight = 4 + Math.max(0, smoothed[bin] - NOISE_FLOOR) * normFactor;
      const x = cx + Math.cos(angle) * (baseRadius + barHeight);
      const y = cy + Math.sin(angle) * (baseRadius + barHeight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = len; i >= 0; i--) {
      const idx = i % len;
      const angle = (idx / len) * Math.PI * 2 - Math.PI / 2;
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

    // Center pulse circle — average floor-subtracted values to match ribbon energy
    let sum = 0;
    for (let i = 0; i <= halfLen; i++) sum += Math.max(0, smoothed[i] - NOISE_FLOOR);
    const avg = sum / (halfLen + 1);

    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius - 5 + avg * normFactor * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // Start the render loop
  useEffect(() => {
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

  const stopAudio = useCallback(() => {
    interrupt();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    dataArrayRef.current = null;
    streamRef.current = null;
    smoothedRef.current = null;
    peakRef.current = 30;
    setMicState("idle");
  }, [interrupt]);

  // ------------------------------------------------------------------
  // When transcript is ready, send it to the agent via chat pipeline
  // ------------------------------------------------------------------

  useEffect(() => {
    if (voiceSession.state === "thinking" && voiceSession.transcript) {
      window.hermesAPI.sendMessage(voiceSession.transcript, profile);
    }
  }, [voiceSession.state, voiceSession.transcript, profile]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    if (voiceState === "error") return voiceSession.error;
    return undefined;
  })();

  const micActive = micState !== "idle" && micState !== "error";

  // Canvas click only interrupts an active voice turn — toggle is handled by the mic button
  const clickHandler = ((): (() => void) | undefined => {
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

      {/* Voice conversation transcript */}
      {messages.length > 0 && (
        <div className="assistant-messages">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`assistant-msg ${m.role === "user" ? "assistant-msg-user" : "assistant-msg-agent"}`}
            >
              {m.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {hintText && (
        <div className={`assistant-mic-hint ${micState === "error" || voiceState === "error" ? "assistant-mic-error" : ""}`}>
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

      {/* Mic on/off toggle */}
      <button
        className={`assistant-mic-toggle${micActive ? " assistant-mic-toggle-active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (micActive) stopAudio();
          else startAudio();
        }}
        title={micActive ? "Turn off microphone" : "Turn on microphone"}
      >
        {micActive ? <Mic size={20} /> : <MicOff size={20} />}
      </button>
    </div>
  );
}

export default Assistant;
