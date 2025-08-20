# Agentic Flows Exercise — Triage Assistant (Node/TypeScript)

Production-like starter for building an agentic triage assistant with planning, tool-use, memory, and guardrails.

## Quickstart
```bash
# Node 18+ required
pnpm i
cp .env.example .env   # put your API key
pnpm triage:run -- --ticket data/tickets/t_0001.json
pnpm test
```

## Scripts
- `pnpm dev` – run CLI in dev mode
- `pnpm triage:run -- --ticket <path>` – run a single ticket
- `pnpm test` – run Vitest test suite

## Structure
```
src/
  agent/        loop, memory, policies, types
  tools/        kb, billing, issues, status, email, escalate
  prompts/      system.txt, planner.txt, reviewer.txt
data/           kb docs + sample tickets
mocks/          mock API endpoints (in-memory stubs)
tests/          agent.spec.ts
```

Follow the milestone plan in your spec. Keep tool calls idempotent and wire `dry_run` through the executor.
