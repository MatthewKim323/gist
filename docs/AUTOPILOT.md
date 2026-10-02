# Autopilot

gist watches Clio on its own. Every check reads Clio (GET only), and only cases that actually changed go back
through the pipeline. Unchanged cases cost $0: no agent run, no model calls.

## What a check does (`lib/server/autopilot/tick.ts`, `autopilotTick()`)

1. Lists matters from Clio (`discoverMatters`) and watches every open matter that already has a digest.
2. Per matter: snapshots what the lawyer last saw (stage, gate statuses by requirement key, red flag titles,
   overdue action ids from the latest digest), then runs `syncMatter` with a quiet in-memory ctx (no
   `agent_runs` row, so the dashboard's latest run stays the one a person started).
3. Nothing changed: one rolling `no_change` row per matter is refreshed, so the feed stays clean.
4. Changed: `runPipeline` without the sync stage (cached stages are free, only deltas cost), then diff into
   `autopilot_events`: `stage_changed`, `new_items`, `gate_flipped`, `newly_overdue`, `new_red_flag`,
   `digest_refreshed`. If a stage fails on OpenAI quota the event reads "digest pending (AI quota)" and the
   code-only diffs (stage, items, gates, deadlines) still land.
5. Stage moves write a plain-English `share_notifications` row ("Case moved to Negotiation") on every active
   share for that matter. Providers see them as "Case updates" on `/s/<token>` and `/provider`.

Safety: a matter with a live pipeline run is skipped. A lock on `autopilot_state.ticking_since` (stale after
10 minutes) means concurrent callers (cron plus an open tab) never double up; the loser gets `ran: false`.

## Surfaces

- `GET /api/autopilot`: state, number of watched cases, last 30 events.
- `PATCH /api/autopilot` `{enabled?, interval_min?}`: toggle or change cadence.
- `POST /api/autopilot/tick`: check now. `?ifDue=1` only runs when due. `?matterId=` limits to one case.
- `GET /api/cron/autopilot`: Vercel Cron entry. Requires `Authorization: Bearer $CRON_SECRET` when
  `CRON_SECRET` is set; runs only when autopilot is on and due.
- Providers get 403 on `/api/autopilot*` and `/api/cron*` (proxy.ts).
- `/cases`: Autopilot card with status, toggle, "Check Clio now" and the activity feed (rows open the dashboard).

## Scheduling

`vercel.json` registers `*/15 * * * *`. Vercel Hobby plans only allow daily crons, so on Hobby either upgrade
to Pro or rely on the in-app scheduler. Without Vercel Cron (local dev, or `VERCEL` unset) the open `/cases`
tab acts as the scheduler: it calls `tick?ifDue=1` when the next check is due, and the card says so.

## Testing without touching Clio (dev only)

`POST /api/autopilot/tick?simulate=stage` fakes a stale snapshot with the previous stage, which exercises the
diff and writes real share notifications. `simulate=all` also fakes a gate flip, a new overdue item, a new
red flag and two new emails. Simulated rows carry `detail.simulated = true`; `?simulate=cleanup` deletes them
and their share notifications. Simulate is refused in production unless `AUTOPILOT_DEV=1`.

Schema: `supabase/migrations/0003_autopilot.sql` (`autopilot_state`, `autopilot_events`, RLS on, no anon policies).
