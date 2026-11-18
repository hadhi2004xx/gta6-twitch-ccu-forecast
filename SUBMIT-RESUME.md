# SUBMIT-RESUME — gta6-twitch-ccu-forecast-01

## Suggested entry title (73 chars)

Rolling-midnight ratio forecaster: similarity-weighted launch-day curves

## What the entry is

`main.ts` (Node 22, erasable TypeScript, standard library only) at the repo
root. It reads every `*.in` case in `$MAKEFUN_INPUT_DIR` (fallback `/input`)
in name order and writes `<id>.out` to `$MAKEFUN_OUTPUT_DIR` (fallback
`/output`). No network, no randomness, no clock: two runs are byte-identical
(verified). Runtime for all four practice cases together: ~0.28 s locally
(limit is 8 s per case).

## Model

For each past launch in the case's `comparables`, take its release-day
curve and the log ratios `lr_h = ln(viewers_h / viewers_1)` for UTC hours
2..24. The forecast for the case's hour h is `p1 * exp(Q_tau(lr_h))` at the
five scored levels, where `Q_tau` is a **similarity-weighted empirical
quantile**:

- **Regime weight (main lever).** A comparable's hour-1 share of its day's
  peak separates rolling-midnight launches (share ~0.3–1.0) from single
  global unlocks later in the UTC day (share <0.03, ratios up to 200x).
  Each comparable is weighted by a Gaussian on `ln(share)` centred on the
  share implied by the target's regime: 0.45 rolling / 0.02 global / 0.30
  other, sigma 2.0. The target regime is read from the case `notes`
  (rolling wins ties — mixed console/PC launches still shape the UTC day
  like rolling ones), with a data fallback: if the six hours before
  day_start already peaked at >= 0.4 * p1, the launch is treated as rolling.
- **Platform weight.** x1.6 when the comparable's platform tokens overlap
  the platforms named in the case notes.
- **Calibration.** Median log-ratio shrunk x0.78 toward flat, spread scaled
  x0.9, both tuned by the staged LOO grid below.
- Comparables that cannot anchor ratios (hour 1 missing/zero, <22 of 24
  hours sampled) are dropped — this automatically excludes the GTA VI
  category's own pre-release premiere history. A comparable named like the
  case's game is never trained on. Degenerate inputs (p1 = 0, no usable
  comparables, broken comparable rows) fall back to a flat p1 row and were
  crash-tested.

## Validation — leave-one-out backtest (local, mirrors the scoring)

Method: each of the 37 real launch comparables in turn plays target —
synthetic case with its own hour-1 print, trained on the other 37 plus the
GTA VI decoy, scored with the contest's log-scale pinball loss against its
actual hours 2..24. The house baseline is the starter formula from
RULES.txt scored identically. (Practice answers are server-side only, so
this LOO is the honest local proxy; the baseline's published practice loss
is ~0.387.)

| LOO pool | This model | House baseline |
|---|---|---|
| All 37 launches (pooled) | **0.7539** | 0.9297 |
| Targets with hour-1 share >= 0.03 (n=29) | **0.3193** | 0.3595 |
| Targets with hour-1 share >= 0.25 (n=24, rolling-like) | **0.2406** | 0.2652 |
| Targets with hour-1 share < 0.03 (n=8, global unlocks) | **2.3292** | 2.9966 |

Per-target wins: 31/37. The scored real cases (four practice launches and
GTA VI itself) are all rolling-midnight console launches — the two middle
rows are the relevant comparison, and the model beats the baseline there
by ~7–11%. Constants came from a staged grid search over this LOO
(share centre/sigma, median shrink, spread scale, platform boost); the
chosen point sits mid-plateau on every axis, not at an extreme.

## Format validation (Pass 4)

- Ran on the kit's four practice cases: outputs `p00..p03.out`, each
  1.4–1.6 KB (limit 65,536), exactly one top-level key `hours`, exactly 23
  rows for hours 2..24, five quantiles per row, all finite, in (0, 1e9],
  non-decreasing — checked by an independent validator script.
- Determinism: two full runs produced byte-identical outputs (`cmp`).
- Edge cases: hour-1 print 0, empty comparables, a comparable with an
  empty hourly series — all produce valid output, no crash.

## Security scans (Pass 4)

- semgrep `--config auto` on `main.ts`: 210 rules, **0 findings**.
- gitleaks on the working tree and on all commits: **no leaks found**.

## Repo contents

- `main.ts` — the entry (no `main.py`, as required: one entrypoint only)
- `LICENSE` — MIT, carries `SPDX-License-Identifier: MIT`
- `.makefun/owner.json` — `{"wallet": "Hent2ShEVMHgVP924NfqYrmCaCBKLfEDkBmFdjx2vm3H"}`
- `SUBMIT-RESUME.md` — this file

## For the submitter

- GitHub route needs the make.fun README (three live badges from the
  requirements' `how_to_submit.readme_template`, no `{owner}` placeholders
  left) and the repo About set (make.fun website + `makefun` topic) before
  submitting; a source-bundle entry needs `init` run in a fresh repo
  instead (this repo was not init-anchored — it was built for the GitHub
  route, with owner.json in the first commit).
- Submit with the kit CLI before **2026-11-19T01:00:00Z** (08:00 WIB).
