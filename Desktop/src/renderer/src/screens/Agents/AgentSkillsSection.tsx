import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentSkill } from "../../../../shared/agents";

/**
 * Theta: which of the server's skills this agent may use. Skills are shared
 * by all agents; each agent can switch any of them off.
 */
export function AgentSkillsSection({ agent }: { agent: string }): React.JSX.Element {
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [installId, setInstallId] = useState("");
  const [onlyThis, setOnlyThis] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.hermesAPI.agentSkills(agent).then((r) => {
      if (!alive) return;
      if (r.ok) setSkills(r.data.skills);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [agent]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, AgentSkill[]>();
    for (const s of skills ?? []) {
      if (q && !`${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q)) continue;
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return [...map.entries()];
  }, [skills, query]);

  const apply = async (changes: Record<string, boolean>): Promise<void> => {
    setError(null);
    setSkills((prev) => prev?.map((s) => (s.name in changes ? { ...s, enabled: changes[s.name] } : s)) ?? prev);
    const r = await window.hermesAPI.setAgentSkills(agent, changes);
    if (r.ok) setSkills(r.data.skills);
    else setError(r.error);
  };

  const install = async (): Promise<void> => {
    setInstalling(true);
    setError(null);
    setNotice(null);
    const r = await window.hermesAPI.installSkillFor(installId.trim(), onlyThis ? [agent] : undefined);
    setInstalling(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setInstallId("");
    setNotice(r.data.installed.length ? `Installed: ${r.data.installed.join(", ")}` : "Already installed.");
    const fresh = await window.hermesAPI.agentSkills(agent);
    if (fresh.ok) setSkills(fresh.data.skills);
  };

  const enabledCount = skills?.filter((s) => s.enabled).length ?? 0;

  return (
    <section>
      <h4>
        Skills {skills && <span className="agent-settings-count">{enabledCount} of {skills.length} on</span>}
      </h4>
      <p className="agent-settings-hint">
        Skills are shared by all agents; switch off the ones this agent shouldn't use.
      </p>
      {error && <div className="agent-settings-error agent-settings-error-inline">{error}</div>}
      {!skills ? (
        !error && <div className="agent-settings-hint">Loading skills…</div>
      ) : (
        <>
          <input
            className="input input-sm agent-skills-search"
            placeholder="Search skills"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="agent-skills">
            {groups.map(([category, list]) => {
              const on = list.filter((s) => s.enabled).length;
              const expanded = open.has(category) || !!query.trim();
              return (
                <div key={category} className="agent-skill-group">
                  <div className="agent-skill-group-head">
                    <button
                      className="agent-skill-expand"
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(category)) next.delete(category);
                          else next.add(category);
                          return next;
                        })
                      }
                    >
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span>{category}</span>
                      <span className="agent-settings-count">
                        {on}/{list.length}
                      </span>
                    </button>
                    <input
                      type="checkbox"
                      title="All skills in this group"
                      checked={on === list.length}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < list.length;
                      }}
                      onChange={(e) =>
                        apply(Object.fromEntries(list.map((s) => [s.name, e.target.checked])))
                      }
                    />
                  </div>
                  {expanded &&
                    list.map((s) => (
                      <label key={s.name} className="agent-tool-row agent-skill-row" title={s.description}>
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() => apply({ [s.name]: !s.enabled })}
                        />
                        <span className="agent-tool-name">{s.name}</span>
                        <span className="agent-tool-desc">{s.description}</span>
                      </label>
                    ))}
                </div>
              );
            })}
          </div>
          <div className="agent-skill-install">
            <input
              className="input input-sm"
              placeholder="Install a skill: hub id or URL"
              value={installId}
              onChange={(e) => setInstallId(e.target.value)}
            />
            <label className="agent-skill-only">
              <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} />
              only for this agent
            </label>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!installId.trim() || installing}
              onClick={install}
            >
              {installing ? "Installing…" : "Install"}
            </button>
          </div>
          {notice && <div className="agent-settings-hint">{notice}</div>}
        </>
      )}
    </section>
  );
}
