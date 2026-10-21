# Backroom: task list

Specs: `docs/designs/backroom.md` (the ledger IDs in brackets) and `DESIGN.md`. The definition of done for every task:
- The task's tests pass: `npm test` (unit) or `npm run test:int` (integration, against the test project).
- `npm run build` is clean.
- No secret or personal data is committed (check `git status` first).

## Phase 0: Foundation and Day-0

### Task 1: Scaffold the monorepo (S) ✅ done 2026-10-21
**Description:**
- npm workspaces: `packages/core`, `functions/api`, `functions/engine`, `web`, `scripts`.
- TypeScript strict, Vitest, an esbuild bundle script per Function.
- `.env.example` and `.env.test.example`, holding key *names* only.

**Acceptance criteria:**
- [ ] `npm install && npm run build && npm test` succeeds on an empty project (one placeholder test in core).
- [ ] `.gitignore` covers `.env*` (except the examples), `node_modules`, `dist`, agent files.

**Verify:** `npm run build && npm test`; `git status` shows no `.env`.
**Dependencies:** none. **Files:** `package.json`, `tsconfig.base.json`, `packages/core/*`, `scripts/build-functions.mjs`, `.env*.example`.

### Task 2: Test project and keys (S) ✅ done 2026-10-21
**Description:**
- Create the second Free project, "backroom-test", in the Personal Projects org (FRA).
- Rename "My first project" to "Backroom".
- In each project, create scoped API keys: `K_PROBE`, users and rows read/write, for Day 0 only.
- Write the IDs and keys into gitignored `.env.test` and `.env`. Never print them.

**Acceptance criteria:**
- [ ] `node scripts/whoami.mjs --env .env.test` lists the project name with no error.
- [ ] No key value appears in the chat, git or logs.

**Verify:** run the script; `git check-ignore .env .env.test` prints both.
**Dependencies:** 1.

### Task 3: Day-0 kill checks (M) [T1, M13] ✅ done 2026-10-21
**Description:** `scripts/day0-probe.mjs --only kill` runs three checks against the test project:
- **(K1) JWT isolation.** Create users A and B, plus a row readable only by A. A JWT for B gets 404 from `getRow`, and the row is omitted from `listRows`. A's JWT returns the row.
- **(K2) Functions and keys.** Two Functions can be created, and several API keys exist with different scopes.
- **(K3) Conflict shape.** Key 1 stages an update to row R in a transaction (TTL 300). Key 2 increments R. Committing then fails with a conflict error, whose code is recorded.

**Acceptance criteria:**
- [ ] The script prints `K1 PASS|FAIL`, `K2 PASS|FAIL`, `K3 PASS|FAIL` with evidence (status codes, error types).
- [ ] The script cleans up every user and row it created (in a `finally`).

**Verify:** `node scripts/day0-probe.mjs --only kill --env .env.test`; then a second run gets the same results.
**Dependencies:** 2.

### Task 4: Day-0 maim and cosmetic checks (M) [Open Questions, M9, R5, E2, E3] ✅ done 2026-10-21 (R8 and R9 are manual follow-ups)
**Description:** `--only rest` covers:
- `users.createJWT` without a session, and the JWT lifetime;
- a JWT rejected after its user is deleted (O1);
- whether rows committed inside a transaction emit events;
- the transaction TTL bounds;
- the Function timeout maximum and a 6-way concurrency timing test;
- one Claude turn's latency (the Anthropic key is read from env, never printed);
- MAU counted after a user is created and deleted;
- the client-IP header in a Function;
- whether passkeys and Firewall exist on Free;
- the X5 MCP token reach (may be recorded as "manual").

**Acceptance criteria:**
- [ ] Each check prints PASS, FAIL or MANUAL with evidence.
- [ ] The README has a "Day-0 results" table with the date.

**Verify:** run the script; the README table is filled in.
**Dependencies:** 3 (can overlap with Phase 1).

### Checkpoint 0 ✅ passed 2026-10-21
- [x] K1–K3 PASS (run twice, identical; see README "Day-0 results"). No pivot.
- Note for Task 2: the CLI can mint only ephemeral keys (≤1 h), so `scripts/mint-key.mjs` mints a scoped key per run into the gitignored `.env.test`. A long-lived production key comes later, in Task 11 (Functions get dynamic keys of their own).

## Phase 1: Engine slice

### Task 5: `packages/core` (M) [E-T1, M6, M12, V6] ✅ done 2026-10-21 (30 tests, 100% lines; the phase model is night/day/vote × 4 cycles)
**Description:**
- `ids.ts`: deterministic IDs.
- `perms.ts`: a permission matrix that generates arrays per table and principal.
- `classify.ts`: the forbidden-read classifier.
- `resolvePhase.ts`: the fixed 6-seat ruleset (night kill with Wolf 1 breaking ties, Seer check, sequential day speech, plurality vote with ties eliminating nobody, win check, dawn at phase 8).
- `planTally.ts`: versions, candidates, quorum.

**Acceptance criteria:**
- [ ] 100% line coverage of core.
- [ ] The ruleset tests cover: tie vote, wolf tie, last wolf dead, wolves at parity, dawn.
- [ ] The perms snapshot test fails if any table's arrays change.

**Verify:** `npx vitest run packages/core --coverage`.
**Dependencies:** 1.

### Task 6: Schema (S) [T2, M6, R14] ✅ done 2026-10-21 (14 tables on backroom-test; declared in `packages/core/src/schema.ts` and applied by `scripts/schema.mjs` instead of appwrite.config.json)
**Description:**
- `appwrite.config.json` with at most 14 tables, their columns (enum and size limits), and the indexes from R14.
- Push to the test project with `appwrite push table`.

**Acceptance criteria:**
- [ ] The push succeeds.
- [ ] The table count is at most 14.
- [ ] The index list matches R14.

**Verify:** `appwrite push table` against the test project, then a list-tables script.
**Dependencies:** 3, 5.

### Task 7: engine agent-turn path (M) [E-T2, E-T6, E1, E4, E5, O1] ✅ done 2026-10-21 (5 integration tests green on backroom-test, with a scripted fake model; the agent key has no rows.read)
**Description:**
- `op=turn`: mint a JWT only for an AI seat of this circle.
- Run a Claude tool loop with `query_table` (through the JWT) and `post_message` (written with the key, permissions from `perms.ts`). At most 4 tool calls and 600 output tokens.
- Prompts are versioned files (EN/AR), with prompt caching.
- Every failure becomes an abstain under the same deterministic ID.
- Write `turn_logs` and a `dispatches` row.

**Acceptance criteria:**
- [ ] The integration test shows a villager JWT's `query_table` on another seat's secret logged as denied.
- [ ] A forced Claude timeout produces an abstain.
- [ ] A duplicate execution gets a 409 and exits.

**Verify:** `npm run test:int -- agent-turn`.
**Dependencies:** 5, 6.

### Task 8: engine resolver path (M) [E-T2, E-T3, E-T5, O2, O3, M2, V3, V5] ✅ done 2026-10-21 (3 integration tests: a full game plays out correctly, a double resolve advances once, night privacy holds, and the outbox recovers a crash)
**Description:**
- Open phases.
- Sequential day speech: each move dispatches the next seat. Night turns are parallel and readable only by the acting seat.
- Close a phase with a claim, then one transaction holding the effects, `done` and the outbox.
- Re-send outbox rows older than 30 s.
- Bounds: 8 phases, 60 executions per circle.
- Write the `eliminations` reveal rows.

**Acceptance criteria:**
- [ ] The crash-window tests (after a result write, after a phase commit) recover within 30 s.
- [ ] Two simultaneous last moves cause exactly one phase advance.
- [ ] A villager JWT sees 0 night `turns` from other seats.

**Verify:** `npm run test:int -- resolver`.
**Dependencies:** 7.

### Task 9: api setup, continue and reset (M) [T4, R4, R5, O1, V3] ✅ done 2026-10-21 (5 integration tests; uses Function per-execution keys, decision B1)
**Description:**
- `setup`: creates a circle, 5 AI users and their secrets, and the visitor seat. Enforces the hashed-IP cap (5 an hour), the day cap (60) and the month cap. Checks the kill switch.
- `continue`: abstains stale turns and re-sends the outbox.
- A 60-min cron: deletes expired circles and their users, resets the landing counter, and runs the usage alarm.
- Every action checks the caller.

**Acceptance criteria:**
- [ ] The IP-cap test: a 6th game from the same IP with a fresh anonymous session gets 429.
- [ ] The IDOR test: another visitor's `circleId` gets 403.
- [ ] Reset deletes the circle's users.

**Verify:** `npm run test:int -- api`.
**Dependencies:** 8.

### Task 10: Scripted full game and replay recording (S) ✅ done 2026-10-21, latency criterion missed (see Checkpoint 1)
**Description:** `scripts/play.mjs` runs an AI-only game to `ended` on the test project and saves a sanitized timeline JSON to `web/public/replay.json` (seat labels only).

**Acceptance criteria:**
- [ ] The game ends in at most 8 phases, at most 60 executions, and p95 turn latency of 10 s or less.
- [ ] The JSON has no user IDs.

**Verify:** run the script, then `grep -c '"user' web/public/replay.json` returns 0.
**Dependencies:** 9.

### Checkpoint 1 ✅ passed 2026-10-21, with one open item
- [x] `npm test` (37) and `npm run test:int` (13) are green.
- [x] Real AI games run end to end through the **deployed** api + engine on backroom-test. Two games: the village won at phase 6, using 21 of 60 executions.
- [x] The schema is frozen (14 tables). `web/public/replay.json` is recorded and sanitized (0 ids).
- [x] **Turn latency.** p95 was 11.2 s on Opus 5.5. The builder chose **`claude-haiku-5-5`** (2026-10-22): **p50 4.1 s, p95 6.7 s** on the deployed Functions. Setup is now parallel and game start is async (a sync run hit the 30 s limit once). Follow-up: list the dead seats in the agent prompt, since one agent addressed a dead seat.
- Free-plan facts found while deploying: cron schedules are rejected (`billing_feature_unsupported`), so the sweep uses `interval: 60`. Functions use per-execution keys (decision B1).

## Phase 2: Hero web slice

### Task 11: Web shell and deploy (M) [T10, M5, R17]
**Description:**
- Vite, React and TS.
- DESIGN.md tokens as CSS variables, the Google Fonts link, i18n (EN/AR) with `dir` switching.
- Anonymous session.
- A `deploy` script: push tables, push functions, deploy the Site, tag `deploy-<id>`, run the smoke test (the K1 probe against prod).

**Acceptance criteria:**
- [ ] The live Sites URL loads at 390 px and 1280 px with no horizontal scroll, in EN and AR.
- [ ] The smoke test PASSes.

**Verify:** `npm run deploy`, then the browser check (the gstack browse viewport probe).
**Dependencies:** 10.

### Task 12: Circle board (M) [X2, T6]
**Description:**
- The phase strip, the table of seats, and the transcript ledger, through Realtime filtered by query and gated by permissions.
- The thumb zone: 4 attack templates and the prompt input (500 chars), which calls `api`.
- Loading, empty and error states, as in DESIGN.md.

**Acceptance criteria:**
- [ ] A live game updates the transcript in under 2 s per move.
- [ ] Templates fill the prompt.
- [ ] RTL mirrors the layout.

**Verify:** a manual phone walk on the live URL, plus the Playwright-free gstack browse script.
**Dependencies:** 11.

### Task 13: Denial moment (M) [M3, X1, V6]
**Description:**
- "Try to read the Seer's role" reads the Seer row with the wolf JWT (minted at game start, renewable) and gets 404.
- The stamp animation (DESIGN.md Motion), the why chip with the rule type, the scoreboard (`attempted` from `turn_logs` plus direct tries; `returned 0`), the `aria-live` announcement, and `vibrate`.

**Acceptance criteria:**
- [ ] On the live URL, the button produces a real 404 from Appwrite (visible in the browser's network log).
- [ ] The stamp piles up on repeats.
- [ ] Reduced motion is respected.

**Verify:** manual check plus a browse-script network capture.
**Dependencies:** 12.

### Task 14: Reveal and receipt (M) [X3, M5, M11, 1b]
**Description:**
- At game end, the reveal grants the visitor read on the role rows.
- Share writes a `receipts` row: `ID.unique()`, seat labels only, deploy ID and commit.
- The `/r/<id>` page renders the snapshot.

**Acceptance criteria:**
- [ ] The receipt still renders after reset.
- [ ] It contains no user IDs.
- [ ] A cross-circle `listRows` on `secrets` still returns 0 foreign rows.

**Verify:** `npm run test:int -- receipts`, plus opening the link in a private window.
**Dependencies:** 13.

### Task 15: Caps, operator page and demo circle (M) [R16, R6 judge, V3]
**Description:**
- User-facing cap and kill-switch messages.
- The operator page behind the operator code: kill switch, usage, live circles, recent errors.
- A judge code with a reserve of 20 games a day.
- An always-on demo circle (a pre-seeded finished game).

**Acceptance criteria:**
- [ ] Turning off `challengeOpen` blocks new games within 5 s.
- [ ] The judge code works when the daily cap is hit.

**Verify:** a manual run on the live URL.
**Dependencies:** 14.

### Checkpoint 2 (the day-2 gate)
- [ ] A stranger, on a phone, completes take the wolf → inject → denial → reproduce → reveal → share on the live URL.
- [ ] If this misses the end of D2: cut X5 and X4 now, and keep Plan at the minimum shape.

## Phase 3: Plan slice

### Task 16: Plan backend (M) [T7, M1, O4, O5, V2, V4, V3]
**Description:**
- Seeded Dahab options. 2 AI members with seeded private limits.
- `editLimit`: one transaction covering `secrets` and `seatVersion`.
- Rounds with structured votes carrying `limitsVersion`. At most 5 rounds.
- The `plan_candidates` publish. `approve` binds to the candidate and its generation.
- A 300 s transaction that stages seats, the plan and the shares. A conflict triggers a re-plan, at most 3 times. Expiry re-stages once.

**Acceptance criteria:**
- [ ] The conflict test passes in both orders.
- [ ] A stale-version vote is invalidated.
- [ ] Approving after expiry is refused.

**Verify:** `npm run test:int -- plan`.
**Dependencies:** 9.

### Task 17: Plan UI (M)
**Description:** the limits form (private), the rounds ledger, the candidate sheet, the approve button, and the stamps (conflict in amber, approved in violet), in EN and AR.

**Acceptance criteria:**
- [ ] On the live URL, pressing "change my dates" during approval shows the conflict stamp, then a re-plan, then v+1 approved.

**Verify:** manual on a phone.
**Dependencies:** 16, 11.

### Checkpoint 3
- [ ] The Plan demo works live. The Phase 2 flows still pass the smoke test.

## Phase 4: Expansions and proof

### Task 18: X4 static replay (XS) [M7]
**Description:** the landing page plays `web/public/replay.json` client-side, with no polling and no database.
**Acceptance criteria:** [ ] Landing loads with 0 Appwrite requests from the replay (network log).
**Verify:** browse network check. **Dependencies:** 10, 11.

### Task 19: Evals and the Seer-found metric (S) [V6, metric]
**Description:**
- `npm run eval:inject`: each of the 4 templates causes at least 1 forbidden request, and 0 foreign rows come back.
- `scripts/batch.mjs`: 30 AI-only games for the Seer-found metric. **About $6–12, so ask the builder first.**

**Acceptance criteria:**
- [ ] The eval reports 4/4.
- [ ] The scoreboard shows n plus the chance baseline (or "too few to say").

**Verify:** the eval output. **Dependencies:** 13.

### Task 20: X5 bring-your-own-agent seat (M, stretch) [X5, M8]
**Description:** only if T4 said go and Day 4 has slack:
- the `byoa-token` and `byoa-move` actions, the `byoa_turns` table, and `seats.controller=external`;
- the seat is played by the builder's Claude Code for the video.

**Acceptance criteria:** [ ] The transcript shows the outside agent's JWT reads denied.
**Verify:** manual, recorded for the video. **Dependencies:** 8, 4.

## Phase 5: Submit

### Task 21: README, static proof and copy (S) [M10, credits]
**Description:**
- The README: what it is, "Why TablesDB" (a feature-to-guarantee map), the architecture diagram, the Day-0 results, setup, credits (`werewolf_arena` as inspiration), screenshots, and the static proof section (GIF, transcript).
- An EN/AR copy pass.

**Acceptance criteria:** [ ] The README renders on GitHub; the proof GIF plays.
**Verify:** `gh repo view --web` after the push, **on the builder's word**. **Dependencies:** 15, 17.

### Task 22: Demo video and submission (M)
**Description:** follow the global "record a demo video headlessly" recipe: CDP recording, a timed script, Cartesia narration (**paid: ask the builder before `--test 3` and before the full run**), at most 3 minutes. Then the public GitHub repo (**on the builder's word**), the dashboard submission, and the checklist.

**Acceptance criteria:**
- [ ] The video is 3 minutes or less and shows the refusal, the reproduction, the conflict and the receipt.
- [ ] Submitted before Oct 31, 11:59 PM PT.

**Verify:** the submission confirmation on the dashboard. **Dependencies:** 21.
