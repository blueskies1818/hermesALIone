import { describe, it, expect } from "vitest";
import { normalizeMathDelimiters } from "./mathDelimiters";

describe("normalizeMathDelimiters", () => {
  it("converts \\( \\) and \\[ \\] to $ forms", () => {
    expect(normalizeMathDelimiters(String.raw`Area \(\pi r^2\) and \[E = mc^2\]`)).toBe(
      String.raw`Area $\pi r^2$ and $$E = mc^2$$`,
    );
  });
  it("leaves code untouched", () => {
    const md = String.raw`Use ` + "`" + String.raw`\(x\)` + "`" + " literally\n```\n" + String.raw`\[not math\]` + "\n```";
    expect(normalizeMathDelimiters(md)).toBe(md);
  });
  it("returns plain text unchanged", () => {
    expect(normalizeMathDelimiters("no math here $5")).toBe("no math here $5");
  });
});
