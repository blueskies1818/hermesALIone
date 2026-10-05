import { memo, useEffect, useState } from "react";

// Mermaid is large: load it only when a diagram is first shown.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

let counter = 0;

/** Theta: render ```mermaid code blocks as diagrams (falls back to the code). */
export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily: '"Google Sans", system-ui, sans-serif',
        });
        const { svg: out } = await mermaid.render(`theta-mermaid-${++counter}`, code);
        if (alive) { setSvg(out); setError(null); }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { alive = false; };
  }, [code]);

  if (error) {
    return (
      <div className="chat-code-block">
        <div className="chat-code-header"><span className="chat-code-lang">mermaid (could not render)</span></div>
        <pre className="mermaid-fallback">{code}</pre>
      </div>
    );
  }
  if (!svg) return <div className="mermaid-block mermaid-loading">Rendering diagram…</div>;
  // securityLevel "strict" makes mermaid sanitise the SVG it returns.
  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />;
});
