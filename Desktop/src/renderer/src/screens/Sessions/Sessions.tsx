import { useEffect, useState, useRef, useCallback, memo } from "react";
import { Plus, Search, X, ChatBubble, Trash } from "../../assets/icons";
import { Archive, ArchiveRestore, Bot, Folder, Pencil, Pin, PinOff } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface CachedSession {
  id: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  pinned?: boolean;
  archived?: boolean;
  project?: string | null;
  agent?: string;
}

type GroupMode = "date" | "project";

interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
}

interface SessionsProps {
  onResumeSession: (sessionId: string) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
  currentSessionId: string | null;
  visible: boolean;
  /** Theta: bumping this focuses the search box (Ctrl+K). */
  focusSearchSignal?: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFullDate(ts: number): string {
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

type DateGroup = "today" | "yesterday" | "thisWeek" | "earlier";

function getDateGroup(ts: number): DateGroup {
  const d = new Date(ts * 1000);
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "yesterday";

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return "thisWeek";

  return "earlier";
}

function groupSessions(
  sessions: CachedSession[],
): Array<{ label: DateGroup; sessions: CachedSession[] }> {
  const groups = new Map<DateGroup, CachedSession[]>();
  for (const s of sessions) {
    const group = getDateGroup(s.startedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(s);
  }
  const order: DateGroup[] = ["today", "yesterday", "thisWeek", "earlier"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
}

function highlightSnippet(snippet: string): React.JSX.Element {
  const parts = snippet.split(/(<<.*?>>)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("<<") && part.endsWith(">>")) {
          return <mark key={i}>{part.slice(2, -2)}</mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function formatModel(model: string): string {
  const name = model.split("/").pop() || model;
  // Shorten common patterns: "gpt-oss-20b:free" → "gpt-oss-20b"
  return name.split(":")[0];
}

// Memoized session card
const SessionCard = memo(function SessionCard({
  session,
  isActive,
  showFullDate,
  onClick,
  onDelete,
  onUpdate,
}: {
  session: CachedSession;
  isActive: boolean;
  showFullDate: boolean;
  onClick: () => void;
  onDelete: (sessionId: string) => void;
  onUpdate: (sessionId: string, changes: { title?: string; pinned?: boolean; archived?: boolean }) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const title = session.title || "New conversation";

  const commitRename = (): void => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== session.title) onUpdate(session.id, { title: next });
  };

  return (
    <div className="sessions-card-wrapper">
      {renaming ? (
        <div className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}>
          <input
            className="sessions-rename-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        </div>
      ) : (
        <button
          className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}
          onClick={onClick}
          onDoubleClick={() => { setDraft(session.title || ""); setRenaming(true); }}
        >
          <div className="sessions-card-main">
            <span className="sessions-card-title">
              {session.pinned && <Pin size={11} className="sessions-pin-mark" />}
              {title}
            </span>
            <span className="sessions-card-time">
              {showFullDate
                ? formatFullDate(session.startedAt)
                : formatTime(session.startedAt)}
            </span>
          </div>
          <div className="sessions-card-tags">
            {session.project && (
              <span className="sessions-tag sessions-tag--project">
                <Folder size={10} /> {session.project}
              </span>
            )}
            {session.agent && session.agent !== "default" && (
              <span className="sessions-tag sessions-tag--agent">
                <Bot size={10} /> {session.agent}
              </span>
            )}
            <span className="sessions-tag">
              {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
            </span>
            {session.model && (
              <span className="sessions-tag sessions-tag--model">
                {formatModel(session.model)}
              </span>
            )}
          </div>
        </button>
      )}
      <div className="sessions-card-actions">
        <button
          className="sessions-card-action"
          title="Rename"
          onClick={(e) => { e.stopPropagation(); setDraft(session.title || ""); setRenaming(true); }}
        ><Pencil size={13} /></button>
        <button
          className="sessions-card-action"
          title={session.pinned ? "Unpin" : "Pin"}
          onClick={(e) => { e.stopPropagation(); onUpdate(session.id, { pinned: !session.pinned }); }}
        >{session.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
        <button
          className="sessions-card-action"
          title={session.archived ? "Unarchive" : "Archive"}
          onClick={(e) => { e.stopPropagation(); onUpdate(session.id, { archived: !session.archived }); }}
        >{session.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}</button>
        <button
          className={`sessions-card-action ${confirmDelete ? "sessions-card-action--danger" : ""}`}
          title={confirmDelete ? "Click again to delete" : "Delete"}
          onMouseLeave={() => setConfirmDelete(false)}
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDelete) onDelete(session.id);
            else setConfirmDelete(true);
          }}
        ><Trash size={13} /></button>
      </div>
    </div>
  );
});

function Sessions({
  onResumeSession,
  onNewChat,
  onDeleteSession,
  currentSessionId,
  visible,
  focusSearchSignal,
}: SessionsProps): React.JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("date");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    const list = await window.hermesAPI.listConversations(100, showArchived);
    setSessions(list);
    setLoading(false);
  }, [showArchived]);

  const handleUpdate = useCallback(
    async (
      sessionId: string,
      changes: { title?: string; pinned?: boolean; archived?: boolean },
    ) => {
      // Optimistic: archiving moves it out of the current view.
      setSessions((prev) =>
        prev
          .map((s) => (s.id === sessionId ? { ...s, ...changes } : s))
          .filter((s) => changes.archived === undefined || s.id !== sessionId),
      );
      const ok = await window.hermesAPI.updateSession(sessionId, changes);
      if (!ok) loadSessions();
    },
    [loadSessions],
  );

  const handleDelete = useCallback(
    async (sessionId: string) => {
      await window.hermesAPI.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSearchResults((prev) =>
        prev.filter((r) => r.sessionId !== sessionId),
      );
      onDeleteSession(sessionId);
    },
    [onDeleteSession],
  );

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!focusSearchSignal) return;
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [focusSearchSignal]);

  // Refresh sessions whenever the Sessions view becomes visible.
  // This ensures new sessions created in the Chat view (via "+")
  // appear immediately when the user navigates back to Sessions,
  // and also fixes stale sessions list after clearing search.
  useEffect(() => {
    if (visible) {
      loadSessions();
    }
  }, [visible, loadSessions]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      const results = await window.hermesAPI.searchSessions(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  const isShowingSearch = searchQuery.trim().length > 0;
  const pinned = sessions.filter((s) => s.pinned);
  const unpinned = sessions.filter((s) => !s.pinned);
  const grouped: { label: string; title?: string; sessions: CachedSession[] }[] = [];
  if (pinned.length > 0) grouped.push({ label: "pinned", title: "Pinned", sessions: pinned });
  if (groupMode === "project") {
    const byProject = new Map<string, CachedSession[]>();
    for (const s of unpinned) {
      const key = s.project || "No project";
      byProject.set(key, [...(byProject.get(key) ?? []), s]);
    }
    for (const [project, list] of [...byProject.entries()].sort((a, b) =>
      a[0] === "No project" ? 1 : b[0] === "No project" ? -1 : a[0].localeCompare(b[0]))) {
      grouped.push({ label: `project:${project}`, title: project, sessions: list });
    }
  } else {
    grouped.push(...groupSessions(unpinned));
  }

  return (
    <div className="sessions-container">
      {/* Header with integrated search */}
      <div className="sessions-header">
        <div className="sessions-header-top">
          <h2 className="sessions-title">{t("sessions.title")}</h2>
          <button className="btn btn-primary " onClick={onNewChat}>
            <Plus size={14} />
            {t("sessions.newChat")}
          </button>
        </div>
        <div className="sessions-view-controls">
          <div className="sessions-segment">
            <button
              className={`sessions-segment-btn ${groupMode === "date" ? "active" : ""}`}
              onClick={() => setGroupMode("date")}
            >Date</button>
            <button
              className={`sessions-segment-btn ${groupMode === "project" ? "active" : ""}`}
              onClick={() => setGroupMode("project")}
            >Project</button>
          </div>
          <button
            className={`sessions-archive-toggle ${showArchived ? "active" : ""}`}
            onClick={() => setShowArchived((v) => !v)}
          >
            <Archive size={13} /> {showArchived ? "Showing archived" : "Show archived"}
          </button>
        </div>
        <div className="sessions-searchbar">
          <Search size={14} className="sessions-searchbar-icon" />
          <input
            ref={searchRef}
            className="sessions-searchbar-input"
            type="text"
            placeholder={t("sessions.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="btn-ghost sessions-searchbar-clear"
              onClick={() => {
                setSearchQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="sessions-loading">
          <div className="loading-spinner" />
        </div>
      ) : isShowingSearch ? (
        isSearching ? (
          <div className="sessions-loading">
            <div className="loading-spinner" />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="sessions-empty">
            <Search size={32} className="sessions-empty-icon" />
            <p className="sessions-empty-text">{t("sessions.noResults")}</p>
            <p className="sessions-empty-hint">{t("sessions.noResultsHint")}</p>
          </div>
        ) : (
          <div className="sessions-list">
            {searchResults.map((r) => (
              <div key={r.sessionId} className="sessions-card-wrapper">
                <button
                  className={`sessions-card ${currentSessionId === r.sessionId ? "sessions-card--active" : ""}`}
                  onClick={() => onResumeSession(r.sessionId)}
                >
                  <div className="sessions-card-main">
                    <span className="sessions-card-title">
                      {r.title ||
                        `${t("sessions.title")} ${r.sessionId.slice(-6)}`}
                    </span>
                    <span className="sessions-card-time">
                      {formatFullDate(r.startedAt)}
                    </span>
                  </div>
                  {r.snippet && (
                    <div className="sessions-result-snippet">
                      {highlightSnippet(r.snippet)}
                    </div>
                  )}
                  <div className="sessions-card-tags">
                    <span className="sessions-tag sessions-tag--source">
                      {r.source}
                    </span>
                    <span className="sessions-tag">
                      {r.messageCount}{" "}
                      {r.messageCount !== 1
                        ? t("sessions.messages")
                        : t("sessions.messageSingular")}
                    </span>
                    {r.model && (
                      <span className="sessions-tag sessions-tag--model">
                        {formatModel(r.model)}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  className="sessions-card-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(r.sessionId);
                  }}
                  title="Delete session"
                >
                  <Trash size={13} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : sessions.length === 0 ? (
        <div className="sessions-empty">
          <ChatBubble size={32} className="sessions-empty-icon" />
          <p className="sessions-empty-text">{t("sessions.empty")}</p>
          <p className="sessions-empty-hint">{t("sessions.emptyHint")}</p>
        </div>
      ) : (
        <div className="sessions-list">
          {grouped.map((group) => (
            <div key={group.label} className="sessions-group">
              <div className="sessions-group-label">
                {group.title ?? t(`sessions.${group.label}`)}
              </div>
              {group.sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  isActive={currentSessionId === s.id}
                  showFullDate={
                    group.label === "thisWeek" || group.label === "earlier"
                  }
                  onClick={() => onResumeSession(s.id)}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Sessions;
