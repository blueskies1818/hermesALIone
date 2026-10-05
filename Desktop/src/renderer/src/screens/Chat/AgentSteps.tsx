import { memo, useState } from "react";
import { Brain, Check, ChevronRight, Loader } from "lucide-react";
import type { ToolStep } from "./types";

/** Pretty-print JSON previews; leave anything else as-is. */
function formatPreview(text?: string): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

function StepRow({ step }: { step: ToolStep }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(step.args || step.result);
  return (
    <div className={`agent-step agent-step-${step.status}`}>
      <button
        className="agent-step-head"
        onClick={() => hasDetail && setOpen((o) => !o)}
        disabled={!hasDetail}
      >
        <ChevronRight size={12} className={`agent-step-chevron${open ? " open" : ""}`} />
        <span className="agent-step-emoji">{step.emoji || "🔧"}</span>
        <span className="agent-step-label">{step.label}</span>
        <span className="agent-step-status">
          {step.status === "running" ? <Loader size={12} className="agent-spin" /> : <Check size={12} />}
        </span>
      </button>
      {open && (
        <div className="agent-step-detail">
          {step.args && (
            <>
              <div className="agent-step-detail-label">Input · {step.tool}</div>
              <pre className="agent-step-pre">{formatPreview(step.args)}</pre>
            </>
          )}
          {step.result && (
            <>
              <div className="agent-step-detail-label">Result</div>
              <pre className="agent-step-pre">{formatPreview(step.result)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Theta: what the agent did to produce a reply — its reasoning and the tool
 * calls it made — collapsed by default, like the ChatGPT / Claude apps.
 */
export const AgentSteps = memo(function AgentSteps({
  steps,
  reasoning,
  live,
}: {
  steps?: ToolStep[];
  reasoning?: string;
  live: boolean;
}): React.JSX.Element | null {
  const [showThinking, setShowThinking] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const stepList = steps ?? [];
  const thinking = (reasoning || "").trim();
  if (!thinking && stepList.length === 0) return null;
  const running = stepList.filter((s) => s.status === "running").length;

  return (
    <div className="agent-steps">
      {thinking && (
        <div className="agent-steps-section">
          <button className="agent-steps-toggle" onClick={() => setShowThinking((v) => !v)}>
            <ChevronRight size={12} className={`agent-step-chevron${showThinking ? " open" : ""}`} />
            <Brain size={13} />
            {live && stepList.length === 0 ? "Thinking…" : "Thought process"}
          </button>
          {showThinking && <div className="agent-thinking">{thinking}</div>}
        </div>
      )}
      {stepList.length > 0 && (
        <div className="agent-steps-section">
          <button className="agent-steps-toggle" onClick={() => setShowSteps((v) => !v)}>
            <ChevronRight size={12} className={`agent-step-chevron${showSteps ? " open" : ""}`} />
            {running > 0 ? <Loader size={13} className="agent-spin" /> : <Check size={13} />}
            {running > 0
              ? `Working… ${stepList.length - running}/${stepList.length} steps`
              : `${stepList.length} step${stepList.length === 1 ? "" : "s"}`}
          </button>
          {showSteps && (
            <div className="agent-step-list">
              {stepList.map((s) => <StepRow key={s.id} step={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
