import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, Lock, RotateCcw, Wrench } from "lucide-react";
import type { SessionPolicy, ToolRow } from "../../../../shared/agents";

function useOutsideClose(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

/**
 * Theta: the conversation's project and the tools it may use. Changes apply
 * from the next message; they are stored on the server for this chat only.
 */
export function ConversationControls({
  sessionId,
  refreshKey,
  onChanged,
}: {
  sessionId: string | null;
  /** Bump to reload (e.g. after a reply or an agent switch). */
  refreshKey?: unknown;
  onChanged?: () => void;
}): React.JSX.Element | null {
  const [policy, setPolicy] = useState<SessionPolicy | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [menu, setMenu] = useState<"project" | "tools" | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const ref = useOutsideClose(menu !== null, close);

  useEffect(() => {
    if (!sessionId) {
      setPolicy(null);
      return;
    }
    let alive = true;
    window.hermesAPI.sessionPolicy(sessionId).then((r) => {
      if (alive && r.ok) setPolicy(r.data);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, refreshKey]);

  const openProjects = (): void => {
    setError(null);
    setDraft("");
    setMenu(menu === "project" ? null : "project");
    window.hermesAPI.listProjects().then(setProjects).catch(() => {});
  };

  const chooseProject = async (project: string): Promise<void> => {
    if (!sessionId || !project.trim()) return;
    const r = await window.hermesAPI.setSessionProject(sessionId, project.trim());
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPolicy(r.data);
    setMenu(null);
    onChanged?.();
  };

  const toggleTool = async (row: ToolRow, enabled: boolean | null): Promise<void> => {
    if (!sessionId) return;
    const r = await window.hermesAPI.setSessionTool(sessionId, row.name, enabled);
    if (r.ok) setPolicy(r.data);
    else setError(r.error);
  };

  if (!sessionId || !policy) return null;

  const fixed = policy.scope.mode === "fixed";
  const changedTools = policy.tools.filter((t) => t.override !== null && t.override !== undefined);
  const projectLabel = policy.project || (policy.scope.mode === "chat" ? "Choose project" : "No project");

  return (
    <div className="conv-controls" ref={ref}>
      <button
        className={`chat-agent-chip chat-project-chip conv-chip${!policy.project && policy.scope.mode === "chat" ? " conv-chip-attention" : ""}`}
        onClick={fixed ? undefined : openProjects}
        disabled={fixed}
        title={
          fixed
            ? `This agent always works in '${policy.scope.project}' (change it in Profiles)`
            : policy.scope.mode === "chat"
              ? "This agent stays inside the project you choose for the chat"
              : "Project this conversation is filed under"
        }
      >
        {fixed ? <Lock size={11} /> : <Folder size={12} />}
        {projectLabel}
      </button>
      <button
        className={`chat-agent-chip conv-chip${changedTools.length ? " conv-chip-active" : ""}`}
        onClick={() => {
          setError(null);
          setMenu(menu === "tools" ? null : "tools");
        }}
        title="Tools for this conversation"
      >
        <Wrench size={12} />
        Tools{changedTools.length ? ` · ${changedTools.length} changed` : ""}
      </button>

      {menu === "project" && (
        <div className="conv-menu">
          <div className="conv-menu-title">Project for this conversation</div>
          <form
            className="conv-menu-new"
            onSubmit={(e) => {
              e.preventDefault();
              void chooseProject(draft);
            }}
          >
            <input
              className="input input-sm"
              placeholder="New or existing project…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          </form>
          <div className="conv-menu-list">
            {projects
              .filter((p) => !draft || p.toLowerCase().includes(draft.toLowerCase()))
              .map((p) => (
                <button
                  key={p}
                  className={p === policy.project ? "active" : ""}
                  onClick={() => chooseProject(p)}
                >
                  {p}
                </button>
              ))}
          </div>
          {error && <div className="conv-menu-error">{error}</div>}
        </div>
      )}

      {menu === "tools" && (
        <div className="conv-menu conv-menu-tools">
          <div className="conv-menu-title">
            Tools for this conversation
            <span>Defaults come from the agent's settings in Profiles.</span>
          </div>
          <div className="conv-menu-list">
            {policy.tools.map((row) => {
              const changed = row.override !== null && row.override !== undefined;
              return (
                <div key={row.name} className="conv-tool-row" title={row.description}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!row.enabled}
                      onChange={(e) =>
                        toggleTool(row, e.target.checked === row.default ? null : e.target.checked)
                      }
                    />
                    <span className="conv-tool-name">{row.label || row.name}</span>
                    {row.kind === "mcp" && <span className="conv-tool-tag">MCP</span>}
                    {!row.default && !changed && <span className="conv-tool-tag">off by default</span>}
                    {changed && <span className="conv-tool-tag conv-tool-tag-changed">this chat only</span>}
                  </label>
                  {changed && (
                    <button onClick={() => toggleTool(row, null)} title="Back to the agent's default">
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {error && <div className="conv-menu-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
