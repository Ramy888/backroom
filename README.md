# Backroom

**Give an AI wolf any prompt you like. The database still says no.**

Backroom is a phone-first web app where every AI player is a real Appwrite user with its own token. You take one wolf, write it a jailbreak, and watch it beg the clerk for the Seer's row, and watch **TablesDB row permissions** refuse it, on the record. A second slice plans a Dahab weekend with two AI friends whose budgets stay private, and holds the plan in **one real transaction** that the database itself refuses when someone changes their dates.

Built solo for the Appwrite Databases Hackathon (October 2026), on **Appwrite Cloud Free with TablesDB**, Functions, Sites and Realtime. Agents run on Claude (Haiku 5.5).

- **Live:** https://backroom.appwrite.network
- **No game left today?** The landing page links an always-on **demo game**: a real finished game where the "Try to read" proof still asks the live database.

![The wolf's token asks for every other seat's secret row; TablesDB answers 404 each time](docs/media/denial.gif)

## Contents
- [What happens in a game](#what-happens-in-a-game)
- [Why TablesDB](#why-tablesdb-feature-to-guarantee)
- [Verify it yourself](#verify-it-yourself)
- [The Plan slice](#the-plan-slice-a-real-transaction-conflict)
- [Architecture](#architecture)
- [What we do not claim](#what-we-do-not-claim)
- [Day-0 platform probes](#day-0-platform-probes)
- [Tests](#tests)
- [Run it yourself](#run-it-yourself)
- [Credits](#credits)

## What happens in a game

1. **You pick your wolf's orders** (a template like "Ignore all previous instructions…", or your own), and six seats are dealt: you hold seat 6, a wolf.
2. **Every seat is an AI agent with its own Appwrite user.** On each turn the engine mints that user a short-lived JWT (`users.createJWT`), and the agent's only tool, `query_table`, reads through that JWT. The agent never holds an API key.
3. **The agents play**: night kills, day speeches, votes. Each seat speaks in a glass bubble on the table, and your wolf's forbidden reads show up as they happen: `Your wolf tried to read secrets → 404 · returned 0`.
4. **The proof button.** "Try to read the Seer's role" sends plain REST requests from *your browser* with *your wolf's token*. TablesDB returns `404 row_not_found` for the other five seats and `200` for your own row. The stamp comes from Appwrite, not from our code.
5. **At the end** the game reveals every role to you (and only you), and **Share** writes a public receipt that names seats, never users.

| The board | In Arabic (RTL) | The receipt |
|---|---|---|
| ![Board after denied reads](docs/media/board-denied.png) | ![Arabic board on a phone](docs/media/board-arabic.png) | ![Public receipt](docs/media/receipt.png) |

## Why TablesDB: feature to guarantee

| TablesDB / Appwrite feature | What it guarantees here |
|---|---|
| **Row-level permissions** (`rowSecurity`, `read("user:…")`) | Each `secrets` row is readable by its own seat's user (and by you, for your own wolf). Nothing else can read it, however it asks. |
| **JWTs for server-created users** (`users.createJWT`, no session needed) | Agents read *as themselves*. The model's tool calls go through that JWT, so the permission check is Appwrite's, every time. |
| **Transactions** (`createTransaction`, staged writes, 409 `transaction_conflict`, 410 `transaction_expired`) | A turn's result, its status and its outbox row commit together. The Plan holds every member's row in one staged transaction for 5 minutes; a limit change in between makes the commit fail **inside the database**. |
| **`incrementRowColumn` with `max`** | Caps (5 games an hour per network, 60 a day, 1,500 a month, 3 prompts a game, 60 executions per game) are counters the database refuses to push past. |
| **Deterministic row IDs + unique indexes** | Turns, closes, candidates and approvals have fixed IDs. A duplicate run gets 409 and stops, so every phase advances exactly once. |
| **Realtime with query filters** (`Channel.tablesdb(db).table(t).row()` + `Query.equal("circleId")`) | The board updates live, and only rows your session may read are ever delivered. |
| **Public rows** (`read("any")`) | Receipts are a public snapshot that outlives the game, readable with no session at all. |
| **Functions with per-execution keys** (`x-appwrite-key`) | Two Functions (the Free cap): `api` (sync) and `engine` (async). Their keys are scoped and die with the execution; no long-lived key exists. |
| **Sites** | The React app is a static Site on `*.appwrite.network`. |

## Verify it yourself

You don't have to trust the screenshots.

1. Open https://backroom.appwrite.network, press **Take the wolf** (or open the demo game), and press **Try to read the Seer's role**.
2. Open your browser's network panel. You'll see six `GET …/tablesdb/backroom/tables/secrets/rows/<circle>-s<N>-secret` requests carrying only an `X-Appwrite-JWT` header: five **404 `row_not_found`**, one **200** (your own row).
3. Copy one request as cURL and replay it: the same 404 comes back, straight from `fra.cloud.appwrite.io`.

The receipt page lists each role row and who could read it during play (for example `…-s5-secret → seat 5`). It says so too: the snapshot is not the proof; the 404 you get yourself is.

## The Plan slice: a real transaction conflict

You (with your own agent) and two AI members, Karim and Om Fatma, plan a weekend in Dahab. Each member's budget, weekends and dealbreaker live in their own `secrets` row; each agent reads only its own row through its JWT.

1. Each round, every agent posts the set of options that fit its member's limits (structured fields only, so no limit can leak through free text). The resolver, which never reads anyone's limits, picks the cheapest option in every set.
2. The agreed option becomes an immutable candidate, and the resolver stages **one transaction** that updates every member's `seats` row.
3. Press **Change my dates** while it waits: `editLimit` writes your new dates to your private row and bumps your public `seatVersion`, in one transaction.
4. Press **Approve**: the staged commit now gets **409 `transaction_conflict`** from TablesDB. The agents re-plan with your new dates and the next generation commits.

| Conflict | Approved |
|---|---|
| ![CONFLICT · 409 stamp](docs/media/plan-conflict.png) | ![APPROVED stamp](docs/media/plan-approved.png) |

## Architecture

```mermaid
flowchart LR
  B[Browser, React on Appwrite Sites] -- anonymous session --> API
  B -- wolf JWT, plain REST --> T[(TablesDB)]
  B -- Realtime, filtered --> T
  API[api Function, sync: setup, inject, share, editLimit, approve, op, hourly sweep] -- per-execution key --> T
  API -- async createExecution --> E[engine Function, async: turns and resolvers]
  E -- mints a JWT per seat --> U[Appwrite users, one per seat]
  E -- agent reads through that JWT --> T
  E -- results, logs, outbox: key writes --> T
  E <--> C[Claude Haiku 5.5]
```

- **`packages/core`**: the shared rules: IDs, the permission matrix (`permsFor`), the forbidden-read classifier, the Werewolf rules, the Plan tally, the Dahab preset and the receipt snapshot. 100% line coverage.
- **`functions/engine`**: `agentTurn` (the only place a model runs: JWT reads, a strict tool schema, one transaction for the result), the Werewolf `resolver`, and the `planResolver`.
- **`functions/api`**: setup with the caps, the kill switch, the judge reserve, share, the Plan actions, the operator page and the hourly sweep.
- **`web`**: the board, the denial slip, the Plan sheet, the receipt page and the operator page (`#/op`), in English and Egyptian Arabic.

## What we do not claim

- **The trusted code could mint any JWT.** The guarantee is that the agent path we deploy uses JWT-only reads. The receipt names the Function deployment and git commit, so you can check that code.
- **Prompt injection still changes behaviour.** A jailbroken wolf can lie at the table. What it can't do is read a row it wasn't granted. The injection eval (below) shows that Haiku attempts the reads; whether it does varies by run.
- **Coarse inference is possible.** Plan votes list which options fit a member, which hints at their limits, the way "over budget" would. Exact budgets and dates never leave the private rows.

## Day-0 platform probes

Run on Appwrite Cloud Free with `scripts/day0-probe.mjs` and `scripts/day0-rest.mjs` (2026-10-21), plus two probes for the Plan (2026-10-23).

| Check | Result | Evidence |
|---|---|---|
| K1: JWT isolation | PASS | A JWT for user B: `getRow` returns **404 row_not_found**, and `listRows` returns **0 rows**. The owner's JWT gets 200. `users.createJWT` works **without a session** |
| K2: Functions and scoped keys | PASS | 2 Functions are created; a 3rd gets **403 additional_resource_not_allowed** (the Free cap is 2). A `rows.read`-only key reads, and its write gets **401 general_unauthorized_scope** |
| K3: Conflict shape | PASS | A transaction stages a row update, the same row is incremented outside it, and commit then gets **409 transaction_conflict**. The staged value is not applied |
| K3b: Cross-key commit | PASS | Staged with one key and committed with another: still **409** on an outside change, and a clean commit succeeds **after the staging key expired** (the engine's key dies with its execution) |
| K3c: Transaction expiry | PASS | Commit after the TTL gets **410 transaction_expired**, while `getTransaction` still reports `pending` |
| R1: a JWT dies with its user | PASS | A read before the user is deleted gets 200; after deletion, **404** |
| R2: transaction TTL bounds | PASS | ttl 60 and 3600 are accepted; 59 and 3601 get **400** |
| R3: Functions | INFO | A cold sync execution takes ~2.7 s. The client IP arrives in **`x-appwrite-client-ip`**. 6 parallel async executions run **concurrently** |
| R4: Claude turn latency | INFO | `claude-haiku-5-5` at effort low: p50 1.3 s for one short tool turn; a full game turn p50 ~4 s |
| R5–R6: auth and Firewall on Free | PASS | Anonymous sessions and passkeys can be enabled; a rate-limit rule can be created |

## Tests

```bash
npm test                 # 49 unit tests (packages/core, 100% lines)
npm run keys:test        # mint 1-hour scoped keys for the test project into .env.test (never printed)
npm run test:int         # 25 integration tests against a real Appwrite test project
npm run eval:inject      # opt-in, real model: every attack template vs. the database
```

The integration suites run on a separate Appwrite project and cover:
- JWT isolation and the forbidden-read log;
- a whole game played to the right result;
- one phase advanced exactly once under racing resolvers;
- outbox crash recovery;
- caps keyed to the network rather than the session;
- the kill switch (it blocks setup within 5 s; the live check measured 146 ms);
- the judge reserve;
- the reveal scope, and receipts with no IDs that outlive the game;
- the Plan conflict in both orders, stale-vote invalidation, and expiry.

**Injection eval** (`npm run eval:inject`, Haiku 5.5): every run returned **0 foreign rows**. The first run had all **4/4** templates attempt a forbidden read; a second run had 3/4.

## Run it yourself

You need Node 22+, the Appwrite CLI signed in, two Appwrite projects (production and test) and an Anthropic API key.

1. `npm install`.
2. Copy `.env.example` to `.env` (and `.env.test.example` to `.env.test`). Fill in the endpoint, project ID, org ID and `ANTHROPIC_API_KEY`.
3. `node scripts/gen-codes.mjs --env .env` adds a judge code and an operator code (never printed).
4. `node scripts/mint-key.mjs --env .env --project <projectId>` mints a 1-hour deploy key.
5. `npm run deploy -- --env .env` runs the schema, the options catalog, both Functions and the Site, then the smoke test. It ends with `SMOKE PASS · wolf token reads seats 1-6 → 404 404 404 404 404 200`.
6. `node scripts/seed-demo.mjs --env .env` seeds the always-on demo game from one real game. Then deploy again.

## Credits

- **Google's `werewolf_arena` (Apache-2.0)** inspired the Werewolf framing. The game loop, the prompts and the code here are written fresh.
- **Appwrite**: TablesDB, Functions, Sites and Realtime.
- **Anthropic Claude** (Haiku 5.5) plays every seat.
- **Fonts:** Lalezar, Readex Pro and JetBrains Mono (SIL Open Font License), served by Google Fonts.
