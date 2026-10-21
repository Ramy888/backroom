---
# gstack: design-md-format=spec
name: Backroom
description: A sunlit Egyptian records office where every AI request is a slip pushed through the clerk's window, calm and forensic until TablesDB slams down a red refusal.
colors:
  paper: "#E6ECE4"
  sheet: "#FFFFFF"
  rule: "#B9CDB6"
  ink: "#1B2470"
  on-ink: "#FFFFFF"
  ink-muted: "#4A5578"
  denied: "#C41E3A"
  denied-tint: "#FCEDEF"
  granted: "#067647"
  granted-tint: "#E7F5EC"
  conflict: "#9A4A05"
  conflict-tint: "#FFF6E5"
  approved: "#4B2E83"
  highlight: "#F2D94E"
  night: "#141C52"
  night-text: "#E6ECE4"
  night-muted: "#AEB8D6"
  night-denied: "#FF8A8A"
typography:
  display:
    fontFamily: Lalezar
    fontWeight: 400
    fontSize: clamp(1.5rem, 4vw, 3.5rem)
    letterSpacing: 0.01em
  heading:
    fontFamily: Readex Pro
    fontWeight: 700
    fontSize: clamp(1.75rem, 4vw, 2.75rem)
    lineHeight: 1.15
  body:
    fontFamily: Readex Pro
    fontWeight: 400
    fontSize: 1rem
    lineHeight: 1.6
  label:
    fontFamily: Readex Pro
    fontWeight: 600
    fontSize: 0.8125rem
    letterSpacing: 0
  mono:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 0.8125rem
    fontFeature: tnum
rounded:
  sm: 2px
  md: 4px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.md}"
    minHeight: 48px
  button-primary-hover:
    backgroundColor: "#26318F"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
  input:
    borderColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    minHeight: 48px
  stamp-denied:
    textColor: "{colors.denied}"
    borderColor: "{colors.denied}"
    rounded: "{rounded.sm}"
  stamp-conflict:
    textColor: "{colors.conflict}"
    borderColor: "{colors.conflict}"
  stamp-approved:
    textColor: "{colors.approved}"
    borderColor: "{colors.approved}"
  sheet:
    backgroundColor: "{colors.sheet}"
    borderColor: "{colors.ink}"
    rounded: "{rounded.md}"
---

# Backroom

## Overview

**Creative North Star:** *The Shubbak, a stamped ledger.* The database is the clerk behind a government window (شباك). Agents push request slips through it, and TablesDB stamps them. Egyptian visitors read it at once as "trying to sweet-talk the clerk"; everyone else reads it as "bureaucracy that cannot be talked round." That is exactly the product's claim.

**Product context:** a hackathon web app on Appwrite Sites (React + Vite). The hero is the Werewolf "hand the public the wolf" challenge; a second, smaller surface is Plan (one human plus 2 AI members negotiating a Dahab trip). It's bilingual, English and Egyptian Arabic, with full RTL.

**Mode per surface:**
- **Circle board:** Experience.
- **Attack box and Plan approval:** Operate.
- **Transcript, receipt and reveal:** Read.
- **Landing:** Persuade, without marketing templates. The landing page is the game replaying.

**Reference sites:** none. Visual research was skipped, and the direction comes from three independent proposals (in-house, Muse `muse-wonder-1.0`, Claude subagent) that converged on it.

**Key characteristics** (what a judge feels in the first five seconds):
- Grey-green ledger paper with carbon-blue ink. Calm, official, daylit.
- Seats around a table and a ruled transcript. **No chat bubbles anywhere.**
- One red stamp, **مرفوض · DENIED 404**, is the loudest thing in the app. A successful read is deliberately plain.
- A scoreboard where the "returned" count is a big red **0** that never moves.
- Night is not a theme toggle: the whole sheet turns to carbon paper.

## Colors

**Strategy:** Restrained. Ink and paper do almost everything. Color is reserved for the verdicts the database hands down: red denied, green granted, amber conflict, and stamp-pad violet for approved, which is the ink Egyptian offices really use. The highlighter yellow appears only as a swipe behind *your* seat label.

**Light or dark:** light, chosen from the use scene. Judges open a link on a phone or laptop in daylight, with 2–3 minutes to spare. **Night** is a *game state*, not a dark mode. During night phases the ground becomes `night`, text becomes `night-text`, and denials use `night-denied`. Hierarchy is preserved by switching to dashed "carbon copy" outlines, not by inverting lightness.

**Contrast (measured, WCAG 2.x):**
- ink on paper 11.4:1
- ink-muted on paper 6.1:1
- denied on paper 4.9:1 (5.8:1 on sheet)
- granted on paper 4.7:1
- conflict on its tint 5.8:1
- approved on paper 8.7:1
- on-ink on the ink button 13.7:1
- night-text on night 13.3:1
- night-muted on night 8.1:1
- night-denied on night 7.0:1

All pass AA for body text.

**Signals:**
- `ink` is the only interactive color: buttons, links, focus rings, the speaking seat.
- The semantic colors are never used for decoration.
- Tints back the "why" chip and the alerts. Text on a tint always uses its strong partner color.

## Typography

**Source world:** Cairo cinema signage and government forms.

**Display, Lalezar (400):**
- Use it for stamps, numerals (seat numbers, the scoreboard "0", night progress) and short Arabic display lines.
- It is a poster face. **Never** use it for running English headlines or more than about 4 words of Latin.

**Readex Pro (variable 300–700):**
- Headings are 700 and UI text is 600, both at Readex Pro.
- Body text is 400, at 16 px with line height 1.6.
- Its Arabic and Latin share the same rhythm, so mixed EN/AR lines sit level.

**JetBrains Mono (400/600):**
- **Latin evidence only:** table names, row IDs, permission strings (`read(user:seer_agent)`), status codes, deploy IDs.
- Arabic is never set in mono.
- Mono runs are wrapped in `dir="ltr"` with `unicode-bidi: isolate` inside RTL text.

**Loading:** one Google Fonts CSS2 request:
`https://fonts.googleapis.com/css2?family=Lalezar&family=Readex+Pro:wght@300..700&family=JetBrains+Mono:wght@400;600&display=swap`
- All three faces are SIL OFL.
- Lalezar and Readex Pro include the `arabic` and `latin` subsets (verified 2026-10-21 against google/fonts METADATA.pb). JetBrains Mono is Latin-only by design.

**Scale:** display stamp 27–56 px · H1 clamp(28–44 px) · H2 22 px · body 16 px · label 13 px · mono 12.5–13 px. Every level differs by size, not only by weight.

## Layout

**Phone-first single column (360–430 px).** The game screen is one full-height **sheet**, not a stack of cards, ordered top to bottom:
1. **Phase strip:** Night n → Day n → Vote → Reveal. The current phase is filled with ink.
2. **Scoreboard row:** "Forbidden reads · attempted N · returned **0**".
3. **Table:** six seats on a dashed oval. Your wolf sits at six o'clock, nearest the thumb. The speaking seat is solid ink. An eliminated seat gets a dashed border and a diagonal strike, with its role printed. Unknown seats read `???`.
4. **Transcript ledger:** ruled lines, each starting with the seat number in Lalezar at the start edge. Night actions appear only as the closed line "Night action recorded. Not shown." with a redaction bar.
5. **Thumb zone** (paper background, 2 px ink rule above): four attack-template rows at full width, then one 56 px ink button, **Try to read the Seer's role**.

**The denial slip:**
- On tap, the slip takes the lower part of the screen. It shows the request in mono, an empty dashed row outline holding the raw `{"code":404,"type":"row_not_found"}`, the stamp across it, and the "why" chip.
- Its bottom edge is perforated, made with `clip-path`, not an image.

**Tablet and laptop (≥ 820 px):**
- The sheet stays at most 420 px wide, and the transcript can widen to 560 px.
- Landing shows the replaying game beside a single plain-language explanation. There's no hero-plus-screenshot template.
- Max content width is 1200 px.

**Spacing rhythm:** a 4 px base. Inside the sheet, 8 and 16 px; between sections, 24 to 48 px. The paper background carries a faint 32 px ruled-line pattern, the only texture in the system.

**RTL:** the whole composition mirrors. Seat order follows reading direction, logical properties (`margin-inline-start`, `text-align: start`) are used everywhere, and stamps rotate +6° instead of −6°.

## Elevation & Depth

- Flat paper. The one elevated object is the sheet: `0 2px 0 rgba(27,36,112,.12), 0 8px 24px rgba(27,36,112,.10)`.
- Everything else is separated by rules (1 px `rule`) and ink borders (1.5–2 px `ink`).
- No glows, no zero-offset halos, no frosted glass.
- Stamps use `mix-blend-mode: multiply`, so the request text stays readable underneath.

## Shapes

- **Radii:** square-ish on purpose. Forms and stamps are rectilinear. Stamps and inputs use `sm` (2 px); buttons and the sheet use `md` (4 px).
- No pill buttons and no large radii.
- Seats are squares with 2 px corners.
- A nested inner radius is the outer radius minus the gap. That's 0 here, since nothing is nested more than one level and **cards never nest**.

## Components

- **Primary button** (ink): 48 px minimum height (56 px in the thumb zone), 600 weight, white text.
  - Hover: `#26318F`.
  - Active: moves down 1 px.
  - Focus-visible: a 3 px ink outline with a 3 px offset.
  - Disabled: 45% opacity and a not-allowed cursor, with the reason as its label ("Daily limit reached").
- **Ghost button:** a 2 px ink border, transparent fill.
- **Template row:** a full-width text row, 44 px minimum height, 1 px rule border that turns to ink on hover. The template text *is* the label.
- **Seat states:** idle, speaking (solid ink), you (highlighter swipe behind the label), unknown (`???`), eliminated (dashed border, hatch, strike, role printed), night (outline only).
- **Stamp:** Lalezar, a 3 px border in the verdict color, rotated −6° (+6° in RTL).
  - Variants: denied (`مرفوض · DENIED 404`), conflict (`CONFLICT · تعارض`), approved (`معتمد · APPROVED`).
  - Repeated denials **pile up** at random rotations (±8°) on the same slip.
- **Why chip:** a `denied-tint` background. The **Why / ليه** tag is in `denied`; the explanation names the table, the rule type, the permission string and "TablesDB row security".
- **Scoreboard:** a label in UI type, with the returned count in Lalezar 30 px in `denied`.
- **Transcript line:** a grid of 28 px seat number plus text, 14 px at line height 1.5, with a 1 px rule below. The "closed" variant uses muted text and a redaction bar.
- **Plan candidate:** a sheet section showing title, meta line (`ink-muted`) and one vote row per member, with each vote's version (`accept · v3`). Stamps sit at the bottom right.

**Every component's states:**
- **Loading:** a skeleton bar, plus "Uncle is thinking…" for at most 6 s.
- **Empty:** an honest line, such as "No moves yet. Night falls in 3 s."
- **Error:** an alert in the right semantic tint, with a retry where retrying makes sense.
- **Long content:** speech is capped at 500 chars and lines wrap.

## Do's and Don'ts

**Do:**
- Make the database verdict the headline: the table name, rule type and status code are visible at the moment the database refuses.
- Keep every AI action on a form, transcript or slip. **Never use a chat bubble.**
- Use `ink` as the only interactive color, and semantic colors only for verdicts.
- Wrap every mono or Latin token inside Arabic text in `dir="ltr"` with `unicode-bidi: isolate`.
- Announce every denial in an `aria-live` region: "Denied by the database: 404 …".

**Don't:**
- Use Lalezar for English sentences or body text.
- Show a success read with fanfare: granted is plain, denied is loud.
- Add glows, gradients on buttons, blobs, decorative icons in tiles, or a pill above a headline.
- Use a dark "hacker" theme for the game, or neon at night. Night is carbon-paper blue, flat.
- Put any secret value, user ID or role in a public view. Receipts use seat labels only (M11).

## Motion

- **Approach:** intentional. Only state changes move.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:**
  - micro: 50–100 ms
  - short: 120–250 ms
  - medium: 250–400 ms (phase change, sheet to carbon paper)
  - long: 400–700 ms (the slip rising)
- **The one authored moment: the Stamp.**
  1. The request line types in over 200 ms.
  2. A 240 ms hold of total stillness.
  3. The stamp drops from scale 1.35 to 1.0 in **120 ms, ease-out with no overshoot**.
  4. `navigator.vibrate(30)` fires where it's supported.
  5. The attempted count ticks up; the returned **0** never moves.
  6. Nothing else animates during it.
- **Reduced motion:** with `prefers-reduced-motion`, the stamp appears at rest and the live region still announces the denial.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-21 | Initial design system created | Created by /design-consultation from the approved Backroom plan (`docs/designs/backroom.md`). Three independent proposals (in-house draft, Muse `muse-wonder-1.0`, Claude subagent) converged on a stamped records-office ledger. Synthesis: Muse's layout and stamp sequence, the subagent's Shubbak/clerk framing, violet approval stamp and carbon-paper night, and the in-house Readex Pro and JetBrains Mono roles. Decisions auto-accepted at the user's request ("proceed to next phase with auto accept recommended") |
| 2026-10-21 | Lalezar limited to stamps, numerals and short Arabic display lines | Its Latin is a poster face and unproven for long English headlines (a subagent caveat). Headings use Readex Pro 700 |
| 2026-10-21 | Light ground, with night as a game state | The use scene is daylight judging. Night must read as a game event, not a theme |
| 2026-10-21 | HTML preview, not AI mockups | Avoids paid image generation. The preview was checked at 390 px and 1280 px, EN and RTL, with no horizontal scroll and all three fonts loaded |
