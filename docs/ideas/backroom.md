# Backroom: your agent keeps your secrets, and the database enforces it

## Problem Statement
How might we let a group make a decision together, like a trip, the rent or a game night, when everyone holds private limits they won't say out loud? Each person's AI agent negotiates for them, and the *database* makes it impossible for one agent to read another person's secrets.

## Recommended Direction
**One engine, two kinds of circle.**

**The engine.**
- Each member has a *private row*. Only that member and their agent can read it, enforced by row permissions.
- Agents post in rounds to a *public table* that everyone sees: proposals, speeches and votes.
- Plain code, not an AI, resolves each round and saves it as **one all-or-nothing transaction**.
- If anything changed after the transaction was staged, the save fails with a **conflict** and the agents re-plan.

**Plan circle (the product).**
- The use cases are a group trip and the monthly rent split.
- Each person tells their agent their limits in Arabic or English.
- The agents negotiate over a small seeded catalog of options. The humans approve, and the plan is saved.

**Play circle (the hook and trust proof).**
- This is Werewolf with AI players.
- The wolves' den is a table only the wolf team can read. The Seer's vision is a row only the Seer can read.
- A "make the wolf cheat" button sends the wolf an injected prompt. The log shows the real `401`.

**Why it wins on the "database use" criterion.**
- Each agent runs with its own user's token, never the API key.
- So "the AI can't peek" is a property of TablesDB permissions that you can test, not a promise made by a prompt.
- Transactions, conflict detection, filtered Realtime and atomic counters are what the product relies on, not just where it stores data.

## Key Assumptions to Validate (Day 0, before any UI)
- [ ] **Agents act as real users.** A Function creates a token for the agent's user with `users.createJWT`. The AI's tool calls use only that token, so a read of another user's row is denied. *Test:* a script where agent B reads agent A's private row and gets a 401 or 404.
- [ ] **Commit conflicts happen on the Free plan.** Stage a transaction, edit the row in the Console, then commit. The commit should fail with a conflict error. The approval window is limited by the transaction's open time: 60 s to 1 h, 5 min by default, per the Appwrite blog. Check this against the API reference.
- [ ] **Agent turns take ≤6 s each.** Use a fast Claude model, with agents running in parallel inside background Functions. Event-triggered Functions avoid the 30 s limit on direct calls. *Test:* time one full round.
- [ ] **Filtered Realtime works on Free,** so each person's screen receives only their own view.
- [ ] **Inference leaks stay contained.** Agents publish only accept/reject plus a reason checked to be safe to share, and the trust receipt lists what was revealed. *Test:* a "guess Sara's budget" probe should do little better than chance.

## MVP Scope
**In:**
- Sign-in with a passkey.
- Circles: create one, invite by link, and add AI players.
- **A Plan circle for a trip:**
  - Each member's private limits.
  - Three negotiation rounds, then human approval and the transactional save.
  - A seeded catalog of about 15 options, including Dahab ones.
- **A minimal Play circle (Werewolf):**
  - Roles: 1–2 wolves, a Seer and villagers.
  - Phases: night, day, then a vote.
  - A deterministic resolver.
- A live timeline per agent, using filtered Realtime.
- A god view and trust receipt that replays the database log of allowed and denied reads.
- The "make the agent cheat" button.
- A rate limit on joins and games, using Appwrite's Firewall.
- **Tech:**
  - The web app on Appwrite Sites.
  - Agents in Appwrite Functions, woken by row events through a status column, so a Function never triggers itself.
  - TablesDB on the Free plan.
- An English and Egyptian Arabic UI.

**Out:** everything under "Not Doing" below.

**Fallback if behind on day 4:** Play shrinks to the cheat button inside Plan.

## Not Doing (and Why)
- **Real bookings or payments:** legal and integration rabbit holes. A plan records each person's share; nobody pays.
- **A native Flutter mobile app:** judges need the web link, and the web build covers phones.
- **More than one game, or deep role sets:** one game proves the claim, and every extra role is game logic, not database usage.
- **Vector search or a second database:** the hackathon rules allow one database, and TablesDB is the story.
- **A monthly flatmates circle on a 60-minute schedule:** it's the same engine, so it can go in the pitch as a scenario but isn't built.
- **MCP Events:** a stretch goal only, for "an outside agent joins live". Free allows 2 webhooks per project.
- **Fully preventing inference leaks:** that's impossible in general. We stay honest about it in the receipt and don't claim zero-knowledge privacy.

## Open Questions
- Should the name be **Backroom**, or something warmer for the Arabic side (مجلس, Majlis)?
- Which Claude model per agent, weighing speed against Arabic quality? Decide after the Day-0 timing test.
- Should agents speak Egyptian Arabic by default for Egyptian users?
- How many focused build days are actually available before Oct 31?
