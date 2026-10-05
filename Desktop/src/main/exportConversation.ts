import { BrowserWindow, dialog } from "electron";
import { writeFile } from "fs/promises";
import { Marked } from "marked";

// Raw HTML inside messages is shown as text, never rendered.
const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const markdownToHtml = new Marked({
  gfm: true,
  renderer: { html: ({ text }) => escapeHtml(text) },
});

const PDF_STYLE = `
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #1f2328; font-size: 12.5px;
         line-height: 1.6; margin: 0; padding: 0 4px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h1 + p { color: #6e7781; margin-top: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #57606a;
       border-top: 1px solid #d0d7de; padding-top: 14px; margin-top: 18px; }
  pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 10px;
        white-space: pre-wrap; word-break: break-word; font-size: 11.5px; }
  code { font-family: "Cascadia Code", Consolas, monospace; background: #f6f8fa; padding: 1px 4px;
         border-radius: 4px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 4px 8px; }
  blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #d0d7de; color: #57606a; }
  img { max-width: 100%; }
`;

async function renderPdf(markdown: string): Promise<Buffer> {
  const body = await markdownToHtml.parse(markdown);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}</style></head><body>${body}</body></html>`;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    });
  } finally {
    win.destroy();
  }
}

/**
 * Theta: save a conversation (already rendered to Markdown by the renderer)
 * where the user chooses, as Markdown or PDF.
 */
export async function exportConversation(
  parent: BrowserWindow | null,
  kind: "md" | "pdf",
  fileName: string,
  markdown: string,
): Promise<{ ok: boolean; canceled?: boolean; savedTo?: string; error?: string }> {
  const filters =
    kind === "pdf"
      ? [{ name: "PDF", extensions: ["pdf"] }]
      : [{ name: "Markdown", extensions: ["md"] }];
  const options = { defaultPath: fileName, filters };
  const choice = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
  try {
    const data = kind === "pdf" ? await renderPdf(markdown) : Buffer.from(markdown, "utf-8");
    await writeFile(choice.filePath, data);
    return { ok: true, savedTo: choice.filePath };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
