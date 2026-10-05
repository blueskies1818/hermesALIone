import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

const ALL = "theta-find";
const CURRENT = "theta-find-current";

/** Ranges of every case-insensitive match of `query` in `root`'s text. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement?.closest(".chat-msg-actions, textarea, button") ?? null)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || "").toLowerCase();
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function clearHighlights(): void {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}

/**
 * Theta: find in the current conversation (Ctrl+F). Highlights matches
 * without touching the message DOM; Enter / Shift+Enter step through them.
 */
export function FindBar({
  containerRef,
  contentKey,
  onClose,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Changes when the conversation content changes, to re-run the search. */
  contentKey: unknown;
  onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return clearHighlights;
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    const found = root && query.trim() ? findRanges(root, query.trim()) : [];
    setRanges(found);
    setIndex((i) => (i < found.length ? i : 0));
  }, [query, contentKey, containerRef]);

  useEffect(() => {
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    clearHighlights();
    if (!ranges.length) return;
    CSS.highlights.set(ALL, new Highlight(...ranges));
    const current = ranges[index];
    if (!current) return;
    CSS.highlights.set(CURRENT, new Highlight(current));
    current.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [ranges, index]);

  const step = (delta: number): void => {
    if (ranges.length) setIndex((i) => (i + delta + ranges.length) % ranges.length);
  };

  return (
    <div className="chat-find-bar" role="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find in conversation"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
      />
      <span className="chat-find-count">
        {query.trim() ? (ranges.length ? `${index + 1}/${ranges.length}` : "0/0") : ""}
      </span>
      <button onClick={() => step(-1)} disabled={!ranges.length} title="Previous (Shift+Enter)">
        <ChevronUp size={14} />
      </button>
      <button onClick={() => step(1)} disabled={!ranges.length} title="Next (Enter)">
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} title="Close (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}
