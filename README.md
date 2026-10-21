# Backroom

Your AI agent keeps your secrets, and the database enforces it, not the prompt. Built for the Appwrite Databases Hackathon on **TablesDB**.

> Work in progress. The design is in `docs/designs/backroom.md` and `DESIGN.md`, and the build plan in `tasks/`.

## Day-0 results (Appwrite Cloud Free, 2026-10-21, `scripts/day0-probe.mjs --only kill`)

| Check | Result | Evidence |
|---|---|---|
| K1: JWT isolation | PASS | A JWT for user B: `getRow` returns **404 row_not_found**, and `listRows` returns **0 rows**. The owner's JWT gets 200. `users.createJWT` works **without a session** |
| K2: Functions and scoped keys | PASS | 2 Functions are created; a 3rd gets **403 additional_resource_not_allowed** (the Free cap is 2). A `rows.read`-only key reads, and its write gets **401 general_unauthorized_scope** |
| K3: Conflict shape | PASS | A transaction stages a row update, the same row is incremented outside it, and commit then gets **409 transaction_conflict**. The staged value is not applied |

The probe ran twice with identical results, and cleanup left 0 users and 0 databases.

### Remaining Day-0 checks (`scripts/day0-rest.mjs`, 2026-10-21)

| Check | Result | Evidence |
|---|---|---|
| R1: a JWT dies with its user | PASS | A read before the user is deleted gets 200; after deletion, **404**. Deleting per-circle agent users revokes any leftover token (O1) |
| R2: transaction TTL bounds | PASS | ttl 60 and 3600 are accepted; 59 and 3601 get **400**. A transaction can stay open for 1 minute to 1 hour |
| R3: Functions | INFO | A **900 s** timeout is accepted. A cold sync execution takes ~2.7 s. The client IP arrives in **`x-appwrite-client-ip`**. 6 parallel async 2-second executions all finish within 3.6 s, so they run **concurrently** |
| R4: Claude turn latency (one tool, short context) | INFO | `claude-opus-5-5` at effort low: 7.1 / 2.3 / 3.4 s (p50 3.4 s). `claude-haiku-5-5` at effort low: 2.0 / 1.3 / 1.0 s (p50 1.3 s) |
| R5: auth methods on Free | PASS | Anonymous sessions and **passkeys** can both be enabled |
| R6: Firewall (WAF) on Free | PASS | A rate-limit rule (resource type `api`) is created and deleted |
| R7: row events from transaction commits | DEFERRED | Not needed: every internal hop is an explicit `createExecution` (E1). Only X5 would rely on it |
| R8: MAU after creating and deleting a user | MANUAL | Usage lags; recheck in Console → Usage |
| R9: X5 MCP token reach | MANUAL | Decided on Day 4, only if X5 is attempted |
