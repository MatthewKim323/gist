# Feature map: pain point -> what we show -> what produces it

Every row traces to a quote on slide 9 of the briefing deck.

## Lawyer view: the 90 seconds, top to bottom

| sec | panel | shows | deck quote it answers | produced by |
|---|---|---|---|---|
| 0-5 | Header | client photo, name, date of incident, days since, stage bar | "client's picture as soon as I open their matter" | sync + photo extracted from the ID scan |
| 5-20 | Money | case value vs coverage behind it (underwater flag + coverage state: known / conflicting / not researched), firm spend, liens | "what is the case worth, and what coverage sits behind it", "how much has the firm already spent" | deterministic code over custom fields + expenses |
| 20-40 | The story | 5 cited bullets | "get me up to speed without me having to ask anyone" | synthesizer over verified facts |
| 40-55 | Red flags | contradictions across sources, things buried in the file | "out of three hundred entries, show me the ten that matter" | swarm + reconciler + embeddings |
| 55-70 | Action | overdue / coming up / waiting on whom, last real client contact | "what's overdue, what's coming, and what's waiting on someone else", "when did anyone last actually talk to the client" | deterministic code over tasks, calendar, comms |
| 70-80 | Since you last opened | new and changed items, grouped | "what changed since I last opened this matter" | sync hashes + per-user last-opened |
| 80-90 | Injuries | diagnoses with page cites into the scans | "somewhere in a 200-page scan are my client's primary injuries" | OCR agents + extractor swarm |

Below the fold (the "dig into everything" mode):
- Top 10 feed with "show all".
- Treatment timeline per provider.
- Ask the case (cmd-K).
- Share log.

Everywhere: every number and date is clickable and opens the source note, email, or PDF page with the quote highlighted. Answers "if a date is on screen, I need to see where it came from" and "click on anything and open the note, document or email."

## Doctor view: 30 seconds

| shows | deck quote |
|---|---|
| Case-alive heartbeat + coarse stage | "is this case even still alive?" |
| Coverage tier (no dollar amounts unless the attorney allows them) | "is there coverage behind the case?" |
| What the firm needs from your office, with due dates | "what does the firm need from my office right now?" |
| Patient attendance signal | "is my patient still showing up to treatment?" |
| Your own records and bills status | "I only ever see the records I sent" |
| Stage-change notifications | "tell me when the case moves" |

Attorney side, for the doctor view:
- Toggles plus a live preview of the doctor view ("let me adjust what the provider sees before I send it").
- Tokenized link, view log, revoke ("what did we share, and has anyone opened it?", "a secure way of sharing part of my case").
- Hidden by default: strategy, value, offers, other lienholders, red flags.

## The agents and what each one is for

| role | what it does | model | pain it kills |
|---|---|---|---|
| Sync | reads Clio (GETs only), hashes every item, detects changes | code | "don't digest the whole case with AI again every time", "what changed" |
| Math | money, dates, overdue, last contact, spend | code, never AI | numbers must be exact, nothing to hallucinate |
| OCR agents | turn scanned pages into text, page by page | gpt-5.4-mini vision | injuries buried in the 200-page scan |
| Extractor swarm | each agent reads one slice and emits facts with an exact quote + source + page | gpt-5.4-mini, in parallel | turns 300 entries into structured, clickable facts |
| Verifier | checks that the quote exists in the source (code), then whether the source supports the claim (Jev) | code + Jev | "if a date is on screen I need to see where it came from" |
| Reconciler | groups facts about the same event across sources (embeddings), flags disagreement, dedups | embeddings + gpt-5.4-mini | "show me the ten that matter", omissions |
| Synthesizer | writes the story + picks the top 10 from verified facts only | gpt-5.5 | up to speed in 90 seconds |
| Redaction gate | scores every outgoing snippet for strategy / money / prior-injury leakage before a share goes out | Jev | "share part of my case without handing over my whole file" |
| Search | hybrid keyword + vector search over facts and scan pages | text-embedding-3-large + Postgres | "sometimes I need to dig into everything" |

## Why a swarm instead of one big call

1. **Speed.** ~300 scan pages read in parallel finish in about a minute instead of 15.
2. **Cost.** Each slice is cached by content hash, so only changed slices rerun. Reopening a case costs $0, and a new email costs cents.
3. **Precise citations.** Each fact comes from one small slice, so it points to one exact note or page.
4. **No omissions.** Every page gets read. Search alone samples the top hits and misses things.

## Why Jev

Jev is a judge, not a writer. It answers typed yes/no/choice questions with a calibrated confidence in under a second for fractions of a cent. That makes it cheap enough to check every claim and every outgoing snippet, which a big model can't do economically. Low-confidence items go to a "needs attorney eyes" tray instead of being shown as fact.
