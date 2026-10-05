import { describe, it, expect } from "vitest";
import { extractFilePaths, previewKind, formatSize } from "./fileRefs";

describe("extractFilePaths", () => {
  it("finds Windows and POSIX paths in text", () => {
    const text = String.raw`Saved to C:\Users\me\.theta\workspace\tasks\plan.md. Also /srv/theta/workspace/out/chart.png, done.`;
    expect(extractFilePaths(text)).toEqual([
      String.raw`C:\Users\me\.theta\workspace\tasks\plan.md`,
      "/srv/theta/workspace/out/chart.png",
    ]);
  });

  it("handles JSON-escaped backslashes and trailing punctuation", () => {
    const text = String.raw`Wrote "C:\\x\\y\\report.pdf").`;
    expect(extractFilePaths(text)).toEqual([String.raw`C:\x\y\report.pdf`]);
  });

  it("adds files written by tools", () => {
    const steps = [
      { id: "1", tool: "write_file", label: "", status: "completed" as const, args: '{"path": "C:/w/a.txt", "content": "x"}' },
      { id: "2", tool: "terminal", label: "", status: "completed" as const, args: '{"command": "ls"}' },
      { id: "3", tool: "patch", label: "", status: "completed" as const, args: '{"path": "C:/w/b.py' },
    ];
    expect(extractFilePaths("", steps)).toEqual(["C:/w/a.txt"]);
  });

  it("ignores URLs and plain words", () => {
    expect(extractFilePaths("see https://example.com/page.html and notes.md")).toEqual([]);
  });
});

describe("previewKind / formatSize", () => {
  it("classifies files", () => {
    expect(previewKind("a.png", "image/png")).toBe("image");
    expect(previewKind("a.md", "application/octet-stream")).toBe("markdown");
    expect(previewKind("a.py", "text/x-python")).toBe("text");
    expect(previewKind("a.pdf", "application/pdf")).toBe("none");
  });
  it("formats sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
  });
});
