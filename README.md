# sloptic-web (sloptic.org)

The public web product for [Sloptic](../sloptic-main). Submit a deployed web app URL, get its
**slop score** (lower is better), the per-axis breakdown (security / qa / performance), the report
card, and coverage. Grading is **passive by default**: an unverified target gets only observational
probes. Active/injection probing is a v2 tier gated behind account-bound domain-ownership
verification. See [CLAUDE.md](CLAUDE.md) for the product rules and the security model, which is the
product and must not be weakened.

## Layout (monorepo, two packages)

- **`web/`** — Next.js (App Router) frontend + thin API (route handlers that enqueue jobs and serve
  status/results). Deploys to Vercel. Holds no LLM key and no grading logic.
- **`worker/`** — Python worker. Imports the pinned `sloptic` grader, runs the passive pipeline
  against a live URL, writes results. Needs Playwright + an LLM key + minutes per job, so it runs off
  Vercel (Fly.io/Render/a container host). This is the heavy, sandboxed piece.
- **`supabase/`** — Postgres schema + migrations (jobs, results, rate limits; v2 adds accounts,
  grants, quotas).
- **`shared/`** — the API + record contract both sides agree on.

## The grader is a dependency

`sloptic` is pinned and consumed, never forked: `sloptic==2.2.0` from PyPI, declared in
`worker/pyproject.toml`, which is the single place the version is stated. Pinned exactly rather
than with a floor, because a grader that moves changes what a score means, and both frozen curves
came from a 1,625-app corpus run with one specific battery. The worker runs it
`--passive-only` (`sloptic.safety.passive_catalog()`) for unverified targets. Probe logic changes
land in the grader repo, never here.

## Status

Phase 1 scaffold. **Not safe to point at real untrusted URLs yet:** the egress sandbox +
redirect-scoping (P0) is not implemented. The worker's fetch path has a single chokepoint
(`worker/sloptic_web_worker/egress.py`) marked for it. See the handoff and CLAUDE.md.

## Local dev

```sh
# web
cd web && npm install && npm run dev

# worker (needs ../sloptic-main alongside this repo)
cd worker && python -m venv .venv && . .venv/bin/activate && pip install -e .
python -m sloptic_web_worker
```

Copy `.env.example` to `.env` in each package and fill it in. Secrets are server-side only.
