import http from "http";
import https from "https";
import type { WebContents } from "electron";
import { getApiServerKey } from "./config";
import { getApiUrl, getRemoteAuthHeader, isRemoteMode } from "./hermes";
import { parseSessionEventBlock } from "./sse-parser";

/**
 * Theta: listens to GET /v1/sessions/{id}/events so the agent can speak up
 * on its own (e.g. the voice agent reporting that the worker finished a
 * task or has a question). One subscription at a time; reconnects with
 * backoff while subscribed.
 */

let current: {
  sessionId: string;
  voice: boolean;
  target: WebContents;
  request: http.ClientRequest | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryDelay: number;
} | null = null;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { ...getRemoteAuthHeader() };
  if (!isRemoteMode()) {
    const apiServerKey = getApiServerKey();
    if (apiServerKey) headers.Authorization = `Bearer ${apiServerKey}`;
  }
  return headers;
}

function connect(): void {
  const sub = current;
  if (!sub) return;
  let url: string;
  try {
    url = `${getApiUrl()}/v1/sessions/${encodeURIComponent(sub.sessionId)}/events${sub.voice ? "?voice=1" : ""}`;
  } catch {
    scheduleReconnect();
    return;
  }
  const requester = url.startsWith("https") ? https.request : http.request;
  const req = requester(url, { method: "GET", headers: authHeaders() }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      scheduleReconnect();
      return;
    }
    sub.retryDelay = 1000;
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk.replace(/\r\n/g, "\n");
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const parsed = parseSessionEventBlock(part);
        if (parsed && current === sub && !sub.target.isDestroyed()) {
          sub.target.send("session-event", parsed);
        }
      }
    });
    res.on("end", () => scheduleReconnect());
    res.on("error", () => scheduleReconnect());
  });
  req.on("error", () => scheduleReconnect());
  req.end();
  sub.request = req;
}

function scheduleReconnect(): void {
  const sub = current;
  if (!sub || sub.retryTimer) return;
  sub.request = null;
  const delay = sub.retryDelay;
  sub.retryDelay = Math.min(sub.retryDelay * 2, 30000);
  sub.retryTimer = setTimeout(() => {
    if (current !== sub) return;
    sub.retryTimer = null;
    connect();
  }, delay);
}

export function subscribeSessionEvents(
  target: WebContents,
  sessionId: string,
  voice: boolean,
): void {
  if (current && current.sessionId === sessionId && current.voice === voice && current.target === target) {
    return;
  }
  unsubscribeSessionEvents();
  current = { sessionId, voice, target, request: null, retryTimer: null, retryDelay: 1000 };
  connect();
}

export function unsubscribeSessionEvents(): void {
  const sub = current;
  current = null;
  if (!sub) return;
  if (sub.retryTimer) clearTimeout(sub.retryTimer);
  sub.request?.destroy();
}
