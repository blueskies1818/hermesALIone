/**
 * Convert LaTeX delimiters many models use — \( … \) and \[ … \] — into the
 * $ … $ / $$ … $$ form that remark-math understands. Code spans and fenced
 * code blocks are left untouched.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown || (!markdown.includes("\\(") && !markdown.includes("\\["))) {
    return markdown;
  }
  // Split into code (fenced or inline) and prose segments.
  const parts = markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => `$$${inner}$$`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner}$`);
    })
    .join("");
}
