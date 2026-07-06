/**
 * cortex-brain/v1 — the brain's half of the wire protocol.
 *
 * Deliberately a MINIMAL local implementation, not an import from cortex: a bot
 * pack runs against whatever cortex is installed, so the only shared contract is
 * the wire format (cortex's own protocol is the normative spec). Per the mirror
 * rule the brain MUST tolerate unknown cortex→brain event types — parseEventLine
 * returns `null` for anything it does not recognise and the caller drops-and-logs.
 *
 * JSONL: one JSON object per line, every line `{ "v": 1, "type": … }`.
 */

export const V = 1 as const;

// ── Cortex → brain events ───────────────────────────────────────────────────

export interface TaskSource {
  surface: string;
  channel: string;
  thread: string;
  user: string;
}

export interface TaskEvent {
  v: 1;
  type: "task";
  task_id: string;
  capability: string;
  payload: Record<string, unknown>;
  source: TaskSource;
  persona?: string;
}

export interface GateVerdictEvent {
  v: 1;
  type: "gate_verdict";
  task_id: string;
  gate: string;
  verdict: "pass" | "fail";
  notes?: string;
  principal: string;
}

export interface CancelEvent {
  v: 1;
  type: "cancel";
  task_id: string;
}

export interface ShutdownEvent {
  v: 1;
  type: "shutdown";
  deadline_ms: number;
}

export interface EffectRejectedEvent {
  v: 1;
  type: "effect_rejected";
  task_id: string;
  effect: string;
  reason: { kind: string; detail: string; retry_after_ms?: number };
}

export interface HelloEvent {
  v: 1;
  type: "hello";
  persona: string;
  agent: string;
  protocol: string;
}

export interface MessageEvent {
  v: 1;
  type: "message";
  task_id: string;
  text: string;
  user: string;
}

export type BrainEvent =
  | TaskEvent
  | GateVerdictEvent
  | CancelEvent
  | ShutdownEvent
  | EffectRejectedEvent
  | HelloEvent
  | MessageEvent;

const KNOWN_EVENT_TYPES = new Set([
  "task",
  "gate_verdict",
  "cancel",
  "shutdown",
  "effect_rejected",
  "hello",
  "message",
]);

/**
 * Tolerant parse of one cortex→brain line. Unknown type or malformed JSON →
 * `null` (drop-and-log at the caller) — the mirror rule; never a throw.
 */
export function parseEventLine(line: string): BrainEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.v !== V || typeof obj.type !== "string") return null;
  if (!KNOWN_EVENT_TYPES.has(obj.type)) return null;
  return obj as unknown as BrainEvent;
}

// ── Brain → cortex effects ──────────────────────────────────────────────────

/** Inline attachment cap: larger payloads go via a scratch path. */
export const MAX_ATTACHMENT_B64_BYTES = 256 * 1024;

export type PostAttachment =
  | { filename: string; b64: string }
  | { filename: string; path: string };

export interface PostEffect {
  v: 1;
  type: "post";
  task_id: string;
  text: string;
  attachment?: PostAttachment;
}

export interface AskPrincipalEffect {
  v: 1;
  type: "ask_principal";
  task_id: string;
  gate: string;
  prompt: string;
}

export interface ResultEffect {
  v: 1;
  type: "result";
  task_id: string;
  status: "complete" | "failed";
  summary?: string;
  reason?: { kind: "cant_do" | "not_now" | "wont_do"; detail: string };
}

export interface LogEffect {
  v: 1;
  type: "log";
  level: "debug" | "info" | "warn" | "error";
  text: string;
}

export type BrainEffect = PostEffect | AskPrincipalEffect | ResultEffect | LogEffect;

/** One effect → one JSONL line (no trailing newline). */
export function encodeEffectLine(effect: BrainEffect): string {
  return JSON.stringify(effect);
}

// ── Incremental JSONL decoder (chunked socket input) ────────────────────────

export class JsonlDecoder {
  private buffer = "";
  private readonly decoder = new TextDecoder("utf-8");

  push(chunk: Uint8Array | string): string[] {
    this.buffer +=
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.length > 0) lines.push(trimmed);
      idx = this.buffer.indexOf("\n");
    }
    return lines;
  }
}
