# Contract: API + grade record (web <-> worker)

The single source of truth for the shapes the frontend, API, and worker agree on. Keep this in sync
with `supabase/migrations` and the TS/Python types.

## Job lifecycle

A grade is async. States (`grades.status`):

- `queued` — accepted, waiting for a worker.
- `running` — a worker has claimed it (`claimed_at` set).
- `done` — finished, a row exists in `results`.
- `failed` — the target could not be graded (dead URL, not a web app, worker error). `error` set.

The API never blocks on a grade. Submit returns an id; the client polls.

## API

### POST /api/grade
Request: `{ "url": string }`
Response `202`: `{ "id": string, "status": "queued" }`
Response `400`: `{ "error": string }` (bad URL, non-http(s), blocked host, rate-limited)

Server-side on submit: normalize to an origin (scheme + host + port, lowercased, no path/query),
reject non-http(s), run the egress pre-check (reject hosts resolving to loopback / RFC1918 /
link-local / 169.254.169.254), enforce IP rate-limit + quota, then insert a `queued` grade.

### GET /api/grade/:id
Response `200`:
```json
{
  "id": "…",
  "status": "queued | running | done | failed",
  "url": "https://example.com",
  "submitted_at": "…",
  "error": null,
  "result": null
}
```
When `status == "done"`, `result` is the object below.

## Grade result

This mirrors `sloptic.cli._grade_record(report, source)` plus web-only metadata. `mode` is always
`passive` in v1. A passive grade is a SUBSET measurement and is NOT comparable to a full grade, so it
carries no full-curve percentile (see the passive-percentile decision).

```json
{
  "mode": "passive",
  "catalog_version": "sloptic-1.1.0",
  "passive_probe_count": 37,
  "slop_score": 42,
  "axis_slop": { "security": 20, "qa": 14, "performance": 8 },
  "coverage": {
    "probes_total": 37,
    "probes_applicable": 23,
    "probes_na": 14,
    "pct_applicable": 62,
    "ran_kinds": ["…"],
    "na_kinds": ["…"]
  },
  "platform": { "…": "off-score host/builder identifier" },
  "surface": { "…": "what discovery observed" },
  "findings": [
    {
      "probe_id": "sec-csp-001",
      "bundle": "security",
      "category": "content-security-policy",
      "penalty": 5,
      "group": "…",
      "reason": "…",
      "target": "…",
      "evidence": { "…": "…" }
    }
  ]
}
```

`axis_slop` sums exactly to `slop_score`. `findings` are the `slop_detected` outcomes only. The three
axes and coverage come straight off the `Report`; `platform` is off-score and labelled as such in the
UI.
