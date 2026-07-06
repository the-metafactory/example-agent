# example-agent

**The canonical sample cortex bot pack for the metafactory stack.** Copy this
repo, rename it, drop in your own logic, and you have an arc-installable agent.
Every file is deliberately minimal and heavily commented — it reads as a
tutorial, not production code.

The sample does three teaching things and nothing more: it **greets** you on a
task, **echoes** a message, and demonstrates the **human-approval gate**. All of
it over `cortex-brain/v1`, the wire protocol between a bot pack's brain and the
cortex daemon-brain host.

---

## Terminology (cortex ubiquitous language)

This pack uses the [cortex](https://github.com/the-metafactory/cortex) domain
language — worth getting right, because the whole point below turns on it:

| Term | Meaning here |
|------|--------------|
| **principal** | the human who installs and runs the pack on their stack |
| **agent** | the stable, long-lived runtime identity (this pack's daemon brain). Its `id` scopes its creds — it never changes per principal |
| **assistant** | the *named being* the agent hosts — the persona + the name. **"The name is config, never contract"** |
| **capability** | the bus-routable ability the assistant declares (here: `example.greet`) |
| **gate** | a human-approval step: the brain emits `ask_principal`, the host returns a `gate_verdict`. The host does the identity check — the brain never infers approval from chat text |

The distinction that matters: **the `agent` is stable; the `assistant` (name +
persona) is the principal's to choose.** See "Choose your own name & persona".

---

## Pack layout

```
arc-manifest.yaml   type: agent, targets: [cortex], lifecycle postinstall
agent.yaml          → ~/.config/cortex/agents.d/example-agent.yaml (the fragment)
persona.md          → ~/.config/cortex/personas/example-agent.md   (default persona)
config.example.env  copy → ~/.config/metafactory/example-agent/.env (your overlay)
brain/
  main.ts           daemon socket shell (auth → decode events ⇄ write effects)
  handler.ts        events → effects: YOUR agent's behaviour lives here
  protocol.ts       minimal cortex-brain/v1 (the wire format IS the contract)
  config.ts         resolves the principal's chosen name + persona
  env.ts            loads the principal's overlay .env
scripts/
  signal-cortex-reload.sh   postinstall step 1 — cortex agents reload
  issue-nats-creds.sh       postinstall step 2 — cortex creds issue example-agent
test/
  handler.test.ts   drives the brain, asserts the exact effect stream
```

## Install

**With arc:**

```bash
arc install example-agent
```

**Hand-drop** (until you publish it to a registry):

```bash
PACK=~/.config/metafactory/pkg/repos/example-agent
mkdir -p "$PACK" && cp -R . "$PACK"
cp agent.yaml   ~/.config/cortex/agents.d/example-agent.yaml
cp persona.md   ~/.config/cortex/personas/example-agent.md
cortex agents reload
cortex creds issue example-agent
```

The principal provisions the surface bot identity (token, channel allowlist) on
the stack — this pack never touches `cortex.yaml` and never carries a token.

## Choose your own name & persona

The reason this is a *pack* and not a fork: many principals install the same
code, but nobody should end up with an identical clone. Identity is a
**principal-owned overlay resolved at brain startup**, never baked into the repo.

- The **agent id** (`agent.yaml`) is stable — it addresses the agent and scopes
  its NATS creds.
- The **assistant name** and **persona** are yours to choose.

Set them without editing the installed pack (so `arc upgrade` never clobbers you):

```bash
mkdir -p ~/.config/metafactory/example-agent
cp config.example.env ~/.config/metafactory/example-agent/.env
$EDITOR ~/.config/metafactory/example-agent/.env   # set EXAMPLE_AGENT_DISPLAY_NAME="Aria"
# optional: drop your own persona
$EDITOR ~/.config/metafactory/example-agent/persona.md
cortex agents reload
```

Resolution order (first hit wins), in `brain/config.ts`:

- **name** — `EXAMPLE_AGENT_DISPLAY_NAME` (env or your overlay `.env`) → pack default
- **persona** — `EXAMPLE_AGENT_PERSONA` (explicit path) → `~/.config/metafactory/example-agent/persona.md` → the pack's `persona.md`

So two operators install the same pack and run **Aria** and **Pylon**, each with
their own persona — no forking, no clobbered upgrades.

## How the brain works

`cortex-brain/v1` is a JSONL wire: cortex sends **events** (`task`, `message`,
`gate_verdict`, `cancel`, `shutdown`, …), the brain replies with **effects**
(`post`, `ask_principal`, `result`, `log`). `main.ts` is a thin socket shell;
all behaviour is in `handler.ts`:

- **task** → greet (using the principal's chosen name), optionally gate, then
  post + `result: complete`.
- **message** → echo it back.
- a capability ending `.confirm` (or `payload.confirm: true`) → `ask_principal`,
  await the host's `gate_verdict`, proceed only on `pass`.

## Dev

```bash
bun install
bun test          # drives the brain, asserts the effect stream
bun run typecheck
```

## Make it your own

1. Rename the repo + the `id`/`name` in `arc-manifest.yaml`, `agent.yaml`,
   `package.json`, and the two `scripts/*.sh`.
2. Declare your real capability in `agent.yaml` (`runtime.capabilities`).
3. Put your logic in `brain/handler.ts` — the protocol (`protocol.ts`) and the
   socket shell (`main.ts`) are reusable substrate you rarely touch.
4. Write your assistant's persona in `persona.md`.
5. Declare any secrets your brain reads in `agent.yaml` (`runtime.brain.secrets`).

## License

MIT — see [LICENSE](./LICENSE).
