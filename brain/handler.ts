/**
 * Example Agent brain core — cortex-brain/v1 events in, effects out.
 *
 * This is where YOUR agent's behaviour lives. The sample does three teaching
 * things and nothing more:
 *   • greets on a task (using the PRINCIPAL-CHOSEN display name),
 *   • echoes a mid-thread message,
 *   • demonstrates the human-approval gate (ask_principal → gate_verdict).
 *
 * Dependency-injected (ExampleDeps) so tests drive it with a recorded `send`
 * and assert the exact effect stream — no socket, no cortex.
 */

import type { BrainEffect, BrainEvent, GateVerdictEvent, TaskEvent } from "./protocol";
import { encodeEffectLine } from "./protocol";

export interface ExampleIdentity {
  /** The principal-chosen display name (see brain/config.ts). */
  displayName: string;
}

export interface ExampleDeps {
  /** Emit one effect line to cortex (socket write in prod; a recorder in tests). */
  send(effect: BrainEffect): void;
  /** Principal-resolved identity — the name greetings use. */
  identity: ExampleIdentity;
  /** Gate-verdict wait ceiling. The HOST gate times out well before this; the
   *  brain ceiling is a belt-and-braces local bound. */
  gateTimeoutMs?: number;
}

interface PendingGate {
  resolve(verdict: GateVerdictEvent): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Pull a line of text out of a task payload (chat or capability task). */
export function textFromPayload(payload: Record<string, unknown>): string {
  for (const key of ["text", "message", "prompt"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

export class ExampleBrain {
  private readonly deps: ExampleDeps;
  private readonly pendingGates = new Map<string, PendingGate>();
  private readonly cancelled = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(deps: ExampleDeps) {
    this.deps = deps;
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Resolves when every in-flight task settled (shutdown drain). */
  async drained(): Promise<void> {
    await Promise.allSettled([...this.inFlight.values()]);
  }

  onEvent(event: BrainEvent): void {
    switch (event.type) {
      case "hello":
        this.log("info", `hello: agent=${event.agent} protocol=${event.protocol}`);
        return;
      case "task": {
        const run = this.runTask(event).finally(() => {
          this.inFlight.delete(event.task_id);
          this.cancelled.delete(event.task_id);
        });
        this.inFlight.set(event.task_id, run);
        return;
      }
      case "message":
        // Simple echo — demonstrates a mid-thread text reply.
        this.deps.send({ v: 1, type: "post", task_id: event.task_id, text: `🔁 You said: ${event.text}` });
        return;
      case "gate_verdict": {
        const key = gateKey(event.task_id, event.gate);
        const pending = this.pendingGates.get(key);
        if (pending === undefined) {
          this.log("warn", `gate_verdict for unknown gate ${key} — dropped`);
          return;
        }
        this.pendingGates.delete(key);
        clearTimeout(pending.timer);
        pending.resolve(event);
        return;
      }
      case "cancel":
        this.cancelled.add(event.task_id);
        this.failGatesForTask(event.task_id, "task cancelled by host");
        return;
      case "effect_rejected":
        this.log("warn", `effect_rejected: ${event.effect} (${event.reason.kind}: ${event.reason.detail})`);
        if (event.effect === "ask_principal") {
          this.failGatesForTask(event.task_id, `ask_principal rejected: ${event.reason.kind}`);
        }
        return;
      case "shutdown":
        // The socket shell owns process exit; gates pending at shutdown fail
        // closed so the drain is bounded.
        for (const [key, pending] of this.pendingGates) {
          clearTimeout(pending.timer);
          pending.resolve(syntheticFail(key, "shutdown drain"));
        }
        this.pendingGates.clear();
        return;
    }
  }

  private async runTask(task: TaskEvent): Promise<void> {
    const taskId = task.task_id;
    const who = task.source.user.trim().length > 0 ? task.source.user : "there";
    const name = this.deps.identity.displayName;

    // 1) Greet — note the greeting uses the PRINCIPAL-CHOSEN display name, so two
    //    operators who both install this pack get "Aria" and "Pylon", not clones.
    this.deps.send({
      v: 1,
      type: "post",
      task_id: taskId,
      text: `👋 Hi ${who} — ${name} here. You asked me to run \`${task.capability}\`.`,
    });

    // 2) Optional human gate. A capability ending `.confirm`, or a payload with
    //    `confirm: true`, must be approved by the principal first. The HOST does
    //    the identity-checked approval; the brain NEVER infers it from chat text.
    const needsConfirm = task.capability.endsWith(".confirm") || task.payload.confirm === true;
    if (needsConfirm) {
      const verdict = await this.askPrincipal(taskId, "confirm", `${name} wants to proceed. Approve?`);
      if (this.cancelled.has(taskId)) return;
      if (verdict.verdict !== "pass") {
        this.deps.send({
          v: 1,
          type: "result",
          task_id: taskId,
          status: "failed",
          reason: { kind: "wont_do", detail: `not approved${verdict.notes ? `: ${verdict.notes}` : ""}` },
        });
        return;
      }
      this.deps.send({ v: 1, type: "post", task_id: taskId, text: "✅ Approved — proceeding." });
    }

    // 3) Do the (trivial) work and report completion.
    const echo = textFromPayload(task.payload);
    if (echo.length > 0) {
      this.deps.send({ v: 1, type: "post", task_id: taskId, text: `You said: “${echo}”.` });
    }
    if (this.cancelled.has(taskId)) return;
    this.deps.send({ v: 1, type: "result", task_id: taskId, status: "complete", summary: `${name} greeted ${who}` });
  }

  /** Emit `ask_principal` and await the host's `gate_verdict` (or fail closed). */
  private askPrincipal(taskId: string, gate: string, prompt: string): Promise<GateVerdictEvent> {
    const key = gateKey(taskId, gate);
    return new Promise<GateVerdictEvent>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingGates.delete(key);
        resolve(syntheticFail(key, "brain-side gate ceiling reached"));
      }, this.deps.gateTimeoutMs ?? 600_000);
      this.pendingGates.set(key, { resolve, timer });
      this.deps.send({ v: 1, type: "ask_principal", task_id: taskId, gate, prompt });
    });
  }

  private failGatesForTask(taskId: string, why: string): void {
    for (const [key, pending] of this.pendingGates) {
      if (!key.startsWith(`${taskId}|`)) continue;
      this.pendingGates.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(syntheticFail(key, why));
    }
  }

  private log(level: "debug" | "info" | "warn" | "error", text: string): void {
    this.deps.send({ v: 1, type: "log", level, text });
  }
}

function gateKey(taskId: string, gate: string): string {
  return `${taskId}|${gate}`;
}

function syntheticFail(key: string, why: string): GateVerdictEvent {
  const [taskId, gate] = key.split("|", 2);
  return {
    v: 1,
    type: "gate_verdict",
    task_id: taskId ?? "",
    gate: gate ?? "",
    verdict: "fail",
    notes: why,
    principal: "",
  };
}

export { encodeEffectLine };
export type { BrainEffect } from "./protocol";
