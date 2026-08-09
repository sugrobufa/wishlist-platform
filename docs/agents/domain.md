# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context** — one `CONTEXT.md` at the repo root + `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — глоссарий домена (комната, зона, вещь,
  сокровищница, тихая бронь…).
  ⚠️ **Глоссарий отстал от модели.** 09.08.2026 (тикет 124) у вещи отменены
  состояния «хочу» и «люблю»; различие живёт в месте — комната и
  сокровищница. Пока `CONTEXT.md` не переписан, по модели вещи верить
  `docs/PRD.md` §2, `docs/ARCHITECTURE.md` §4 и §6 и
  `design/package/handoff/items.json` (v2), а не глоссарию.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- Продуктовый контекст: `docs/PRD.md`, `docs/ARCHITECTURE.md`; контракты UI —
  `design/package/handoff/*` (items.json, rooms.json, tokens.json, motion.json).

If any of these files don't exist, **proceed silently**. The `/domain-modeling`
skill creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
