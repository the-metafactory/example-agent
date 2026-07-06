import { test, expect } from "bun:test";
import { ExampleBrain } from "../brain/handler";
import { parseEventLine } from "../brain/protocol";
import type { BrainEffect, PostEffect, ResultEffect } from "../brain/protocol";

const source = { surface: "discord", channel: "c", thread: "t", user: "alice" };

function recorder(name = "Example Agent", gateTimeoutMs = 1_000) {
  const effects: BrainEffect[] = [];
  const brain = new ExampleBrain({
    send: (e) => effects.push(e),
    identity: { displayName: name },
    gateTimeoutMs,
  });
  return { brain, effects };
}

const posts = (fx: BrainEffect[]): PostEffect[] => fx.filter((e): e is PostEffect => e.type === "post");
const result = (fx: BrainEffect[]): ResultEffect | undefined =>
  fx.find((e): e is ResultEffect => e.type === "result");

test("greets and completes a plain task using the principal's display name", async () => {
  const { brain, effects } = recorder("Aria");
  brain.onEvent({ v: 1, type: "task", task_id: "1", capability: "example.greet", payload: {}, source });
  await brain.drained();

  expect(posts(effects)[0]?.text).toContain("Aria");
  expect(result(effects)?.status).toBe("complete");
});

test("echoes payload text back into the thread", async () => {
  const { brain, effects } = recorder();
  brain.onEvent({
    v: 1,
    type: "task",
    task_id: "2",
    capability: "example.greet",
    payload: { text: "hello world" },
    source,
  });
  await brain.drained();

  expect(posts(effects).some((p) => p.text.includes("hello world"))).toBe(true);
  expect(result(effects)?.status).toBe("complete");
});

test("echoes a mid-thread message", () => {
  const { brain, effects } = recorder();
  brain.onEvent({ v: 1, type: "message", task_id: "3", text: "ping", user: "alice" });

  expect(posts(effects).some((p) => p.text.includes("ping"))).toBe(true);
});

test("a .confirm capability asks the principal and proceeds on pass", async () => {
  const { brain, effects } = recorder("Aria");
  brain.onEvent({ v: 1, type: "task", task_id: "4", capability: "example.confirm", payload: {}, source });

  // ask_principal is emitted synchronously, before the brain awaits the verdict.
  expect(effects.some((e) => e.type === "ask_principal")).toBe(true);

  brain.onEvent({ v: 1, type: "gate_verdict", task_id: "4", gate: "confirm", verdict: "pass", principal: "op" });
  await brain.drained();

  expect(posts(effects).some((p) => p.text.includes("Approved"))).toBe(true);
  expect(result(effects)?.status).toBe("complete");
});

test("a failed gate verdict fails the task wont_do", async () => {
  const { brain, effects } = recorder("Aria");
  brain.onEvent({ v: 1, type: "task", task_id: "5", capability: "example.confirm", payload: {}, source });
  brain.onEvent({
    v: 1,
    type: "gate_verdict",
    task_id: "5",
    gate: "confirm",
    verdict: "fail",
    principal: "op",
    notes: "nope",
  });
  await brain.drained();

  const r = result(effects);
  expect(r?.status).toBe("failed");
  expect(r?.reason?.kind).toBe("wont_do");
});

test("cancel fails a pending gate closed without a result", async () => {
  const { brain, effects } = recorder("Aria");
  brain.onEvent({ v: 1, type: "task", task_id: "6", capability: "example.confirm", payload: {}, source });
  brain.onEvent({ v: 1, type: "cancel", task_id: "6" });
  await brain.drained();

  // Cancelled task emits no completion/failure result (host abandoned it).
  expect(result(effects)).toBeUndefined();
});

test("parseEventLine tolerates unknown/malformed lines (mirror rule)", () => {
  expect(parseEventLine("{bad json")).toBeNull();
  expect(parseEventLine(JSON.stringify({ v: 1, type: "some_future_event" }))).toBeNull();
  expect(parseEventLine(JSON.stringify({ v: 2, type: "task" }))).toBeNull();
  const ok = parseEventLine(JSON.stringify({ v: 1, type: "message", task_id: "x", text: "hi", user: "u" }));
  expect(ok?.type).toBe("message");
});

test("the brain never throws on a hello event", () => {
  const { brain } = recorder();
  expect(() =>
    brain.onEvent({ v: 1, type: "hello", agent: "example-agent", persona: "p", protocol: "cortex-brain/v1" }),
  ).not.toThrow();
});
