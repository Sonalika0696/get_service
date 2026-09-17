# SocietyFinTech — Phase 13 offline simulation harness

Offline, pure-Python economic-evaluation harness for the dissertation. No
database, no Node, no network services, no dependency on the `backend/`
runtime — this package only reads the backend's TypeScript billing modules
as a reference for semantics (telescoping slabs, area apportionment, water
blend), it never imports or calls them.

## Setup

From the repository root:

```powershell
py -3 -m venv simulation\.venv
simulation\.venv\Scripts\python.exe -m pip install --upgrade pip
simulation\.venv\Scripts\python.exe -m pip install -e simulation[dev]
```

(`py -3` is Python 3.13 on this machine — never `python3`, which is the
Windows Store stub and hangs.) The venv and `__pycache__` are excluded via
`simulation/.gitignore`; `simulation/outputs/` is excluded by the repo root
`.gitignore`.

## Running

All commands run **from `simulation/`**, using the venv interpreter:

```powershell
cd simulation
.venv\Scripts\python.exe -m sim run --scenario baseline
.venv\Scripts\python.exe -m sim run --scenario all          # every scenario in one go
.venv\Scripts\python.exe -m sim run --scenario baseline --seed 123 --out outputs
.venv\Scripts\python.exe -m pytest                           # functional-accuracy + engine tests
```

Each run writes `outputs/<scenario>/`:

- `results.json` — machine-readable (schema below)
- `report.md` — human-readable summary with headline numbers and 95% CIs
- `run_manifest.json` — seed, full parameter set, UTC timestamp, git commit
- a handful of `*.png` plots (distribution histograms for Monte Carlo
  scenarios, sweep line-charts for sensitivity scenarios)

A run is **deterministic given its seed**: two runs with the same `--seed`
produce byte-identical `results.json` / `run_manifest.json` apart from the
`timestamp_utc` field. This was checked by running
`sim run --scenario baseline` twice into separate `--out` directories and
diffing the parsed JSON with `timestamp_utc` popped from both — see the
Phase 13 completion report for the exact commands.

## Scenarios

| Scenario | Phase 13 checklist item | What it reports |
|---|---|---|
| `baseline` | 1 | 90-flat, 12-month Monte Carlo combining every engine; headline means + 95% CIs |
| `ht_vs_lt` | 2 (principal result) | Bulk HT connection cost vs aggregate individual LT connections |
| `electricity_sensitivity` | 3 | HT-vs-LT saving swept over tariff differential, common-area load fraction, regulatory margin cap |
| `pooling_aggregation` | 4 | Pooled-request saving vs participation rate and category threshold, against published card rates (volume effect only — vendors do not bid) |
| `collections` | 5 | Collection-rate distribution and arrears ageing under varying payment behaviour |
| `water_volatility` | 6 | Blended water rate under seasonal tanker dependency, swept over municipal-interruption probability |
| `corpus_sweep` | 7 | FD-ladder yield vs frequency of missing a seasonal cash call, swept over corpus size and float floor |

Functional-accuracy checks (checklist item 8) run on **every** scenario
(cheap to compute) and are also the dedicated pytest suite in `tests/`:
slab-boundary billing correctness, apportionment conservation with
deterministic largest-remainder residue, ledger idempotency, pricing-card
freeze/binding, and an exhaustive role x capability access-control matrix
(including that delegation can never confer a financial or voting
capability).

## `results.json` schema

```jsonc
{
  "scenario": "baseline",
  "seed": 20240913,
  "timestamp_utc": "2026-01-01T00:00:00+00:00",
  "payload": {
    "kind": "monte_carlo" | "sensitivity" | "monte_carlo_plus_sensitivity",
    "iterations_run": 2000,               // monte_carlo* only
    "metrics": {                          // monte_carlo* only: name -> summary
      "saving_rs": { "mean": 0.0, "std": 0.0, "ci95_low": 0.0, "ci95_high": 0.0, "n": 2000 }
    },
    // sensitivity scenarios instead carry one or more named arrays of row
    // objects, e.g. "tariff_differential": [ { "ht_rate_multiplier": 0.9, "saving_rs_mean": ... }, ... ]
  },
  "functional": [
    { "name": "slab_boundaries", "passed": true, "detail": "..." },
    ...
  ]
}
```

`run_manifest.json` carries `scenario`, `seed`, `timestamp_utc`,
`git_commit` (null if not obtainable) and the full `params` (every field of
`SimParams`, i.e. every assumption that produced this run).

Money throughout the electricity/water engines is computed in **integer
paise** internally (mirroring the backend's money-determinism convention)
and only converted to rupees for the reported metrics.

## Package layout

```
simulation/sim/
├── config.py           # every parameter, each commented as an illustrative assumption
├── synthetic/           # society, residents, consumption, water, vendor-card generators
├── engine/              # electricity (tariff+apportionment), water blend, requests/pooling,
│                        # collections/arrears, treasury/FD ladder, ledger, clock
├── analysis/            # monte_carlo (run-until-stable + 95% CI), sensitivity (sweeps),
│                        # functional (the checklist-8 checks), access_control (role matrix data),
│                        # report (JSON/Markdown/PNG writer)
├── scenarios.py         # one function per named scenario, registered in REGISTRY
└── cli.py               # `sim run --scenario <name>`
```

## Assumptions and limitations (threats to validity)

**All data in this package is synthetic.** Every tariff rate, load fraction,
vendor card price, payment-behaviour distribution, water source cost and FD
rate in `sim/config.py` is an invented, illustrative number, commented
inline as such at its definition. None of it is sourced from a real DISCOM
tariff order, a real bank's rate sheet, or a real society's accounts.

- **The reference electricity tariff regime is an OPEN question** for this
  project (Indian DISCOM tariffs differ materially by state). `LT_TARIFF`
  and `HT_TARIFF` in `sim/config.py` are labelled an "illustrative reference
  regime" and must never be read as any specific regulator's published
  tariff.
- **Results are internally consistent, not externally calibrated.** The
  simulation's arithmetic (slab telescoping, area apportionment, water
  blending, ledger conservation) is verified to be *correct* by the
  functional-accuracy test suite, and the qualitative direction of every
  sensitivity sweep (e.g. HT saving falls as the tariff differential
  narrows) is robust — but the *magnitude* of any headline number depends on
  the illustrative parameter choices and would shift under a different,
  equally plausible set of assumptions.
- **No lending, wallets, vouchers, or vendor-bidding scenarios exist
  anywhere in this package**, per `DECISIONS_V2_SCOPE.md`: the pooled-request
  saving isolates the pure aggregation/volume effect against a single
  published pricing card, because the product does not implement
  competitive vendor bidding.
- **The access-control matrix in `sim/analysis/access_control.py` is only
  partly transcribed from the source documents.** The rows for "raise/join a
  service request", "create an event", "approve expenditure rung 2/3", and
  "assign a vendor to a pool" are transcribed verbatim from
  `DOC_AMENDMENTS_V2.md` A8 (the only enumerated RoU §6 fragment present in
  this worktree). The remaining rows are this simulation's own reasonable
  completion of a role x capability table, consistent with the narrative
  sections of `SOFTWARE_DESIGN.md` (§7.1, §8.1, §8.3) but not transcribed
  from an enumerated source table — each such row is flagged
  `source="assumption"` in the data itself.
- No usability claim is made anywhere in this package; it is a purely
  computational evaluation.
