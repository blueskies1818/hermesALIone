import type { ToolStep } from "./types";

/** Argument names tools use for the file they write. */
const PATH_KEYS = ["path", "file_path", "filepath", "output_path", "target_path"];
/** Tools whose path argument is a file they created or changed. */
const WRITING_TOOLS = new Set(["write_file", "patch", "image_generate"]);

// Absolute Windows (C:\…\name.ext) or POSIX (/…/name.ext) paths with an extension.
const WIN_PATH = /[A-Za-z]:[\\/](?:[^\s"'`<>|*?\n\\/]+[\\/])*[^\s"'`<>|*?\n\\/]+\.[A-Za-z0-9]{1,8}/g;
const POSIX_PATH = /(?<![\w.:/])\/(?:[^\s"'`<>|*?\n/]+\/)+[^\s"'`<>|*?\n/]+\.[A-Za-z0-9]{1,8}/g;

function clean(path: string): string {
  return path.replace(/[),.;:\]]+$/, "");
}

/**
 * Candidate file paths for a reply: absolute paths mentioned in the text,
 * plus files written by tools. The server decides which ones are real and
 * shareable (workspace / vault only).
 */
export function extractFilePaths(content: string, steps?: ToolStep[]): string[] {
  const found = new Set<string>();
  const text = (content || "").replace(/\\\\/g, "\\");
  for (const re of [WIN_PATH, POSIX_PATH]) {
    for (const m of text.matchAll(re)) found.add(clean(m[0]));
  }
  for (const step of steps ?? []) {
    if (!WRITING_TOOLS.has(step.tool) || !step.args) continue;
    try {
      const args = JSON.parse(step.args) as Record<string, unknown>;
      for (const key of PATH_KEYS) {
        if (typeof args[key] === "string" && args[key]) found.add(args[key] as string);
      }
    } catch {
      /* truncated preview — ignore */
    }
  }
  return [...found].slice(0, 20);
}

export type PreviewKind = "image" | "markdown" | "text" | "none";

const TEXT_EXT = new Set([
  "txt", "log", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "css",
  "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "sh", "ps1", "toml", "ini", "sql",
]);

export function previewKind(name: string, mime: string): PreviewKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") && ext !== "svg") return "image";
  if (ext === "md" || ext === "markdown" || mime === "text/markdown") return "markdown";
  if (mime.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  return "none";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
