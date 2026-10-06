import { useEffect, useState } from "react";
import type { WorkSettings } from "../../../../shared/agents";

/**
 * Theta: how background (Kanban) work is allowed to finish — whether a
 * verified branch is merged automatically — and a daily token budget.
 */
export function BackgroundWorkSettings(): React.JSX.Element {
  const [work, setWork] = useState<WorkSettings | null>(null);
  const [budget, setBudget] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    window.hermesAPI.workSettings().then((r) => {
      if (!r.ok) {
        setStatus(r.error);
        return;
      }
      setWork(r.data);
      setBudget(r.data.daily_tokens ? String(r.data.daily_tokens) : "");
    });
  }, []);

  const save = async (patch: Partial<Pick<WorkSettings, "merge" | "daily_tokens">>): Promise<void> => {
    const r = await window.hermesAPI.updateWorkSettings(patch);
    if (!r.ok) {
      setStatus(r.error);
      return;
    }
    setWork(r.data);
    setStatus("Saved");
    setTimeout(() => setStatus(null), 2000);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">Background work</div>
      {!work ? (
        <div className="settings-field-hint">{status || "Loading…"}</div>
      ) : (
        <>
          <div className="settings-field">
            <label className="settings-field-label">When a coding task passes its checks</label>
            <select
              className="input"
              value={work.merge}
              onChange={(e) => save({ merge: e.target.value as WorkSettings["merge"] })}
            >
              <option value="never">Leave it on its branch for me to review</option>
              <option value="auto">Merge it into the repo's current branch automatically</option>
            </select>
            <div className="settings-field-hint">
              Tasks always run in their own git worktree and branch. Automatic merging only happens
              when your checkout has no uncommitted changes and there are no conflicts.
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Daily token budget</label>
            <input
              className="input"
              type="number"
              min={0}
              step={100000}
              placeholder="No limit"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              onBlur={() => {
                const value = Math.max(0, Math.floor(Number(budget) || 0));
                if (value !== work.daily_tokens) void save({ daily_tokens: value });
              }}
            />
            <div className="settings-field-hint">
              Used today by background workers: {work.used_today.toLocaleString()} tokens
              {work.daily_tokens ? ` of ${work.daily_tokens.toLocaleString()}` : ""}. When the
              budget is reached, new tasks wait until tomorrow. Leave empty for no limit.
            </div>
          </div>
          {status && <div className="settings-field-hint">{status}</div>}
        </>
      )}
    </div>
  );
}
