"""Writes a scenario run's artefacts to `simulation/outputs/<scenario>/`:
results.json (machine-readable), report.md (human-readable), a handful of
matplotlib PNGs, and run_manifest.json (seed, full params, UTC timestamp,
git commit if obtainable). See simulation/README.md for the results.json
key schema.
"""

from __future__ import annotations

import dataclasses
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless: never opens a window, safe in CI / offline runs
import matplotlib.pyplot as plt

from sim.analysis.functional import CheckResult, run_all_checks
from sim.config import SimParams


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, cwd=Path(__file__).resolve().parents[2])
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception:
        pass
    return None


def _params_to_dict(params: SimParams) -> dict:
    return dataclasses.asdict(params)


def _functional_to_list(checks: list[CheckResult]) -> list[dict]:
    return [dataclasses.asdict(c) for c in checks]


def write_run(scenario: str, params: SimParams, payload: dict, out_root: Path, timestamp: datetime | None = None) -> Path:
    """Writes every artefact for one run. `timestamp` is injectable for
    testing; defaults to the current UTC time.
    """

    out_dir = out_root / scenario
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = timestamp or datetime.now(timezone.utc)
    ts_iso = ts.isoformat()

    functional_checks = run_all_checks()

    raw_samples = payload.pop("raw_samples", None)  # never persisted to results.json (large; PNGs are the durable artefact)

    results = {
        "scenario": scenario,
        "seed": params.seed,
        "timestamp_utc": ts_iso,
        "payload": payload,
        "functional": _functional_to_list(functional_checks),
    }
    (out_dir / "results.json").write_text(json.dumps(results, indent=2, sort_keys=True, default=str), encoding="utf-8")

    manifest = {
        "scenario": scenario,
        "seed": params.seed,
        "timestamp_utc": ts_iso,
        "git_commit": _git_commit(),
        "params": _params_to_dict(params),
    }
    (out_dir / "run_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, default=str), encoding="utf-8")

    _write_report_md(scenario, params, payload, functional_checks, ts_iso, out_dir)
    _write_plots(scenario, payload, raw_samples, out_dir)

    return out_dir


def _write_report_md(scenario: str, params: SimParams, payload: dict, functional_checks: list[CheckResult], ts_iso: str, out_dir: Path) -> None:
    lines = [
        f"# Simulation report — `{scenario}`",
        "",
        f"- Seed: `{params.seed}`",
        f"- Generated: `{ts_iso}`",
        f"- Flats: {params.n_flats}, horizon: {params.horizon_months} months",
        "",
        "**All figures are derived from synthetic, illustrative data. See README.md "
        "\"Assumptions and limitations\" — results are internally consistent, not "
        "externally calibrated to any real DISCOM, bank, or society.**",
        "",
    ]

    if payload.get("kind") in ("monte_carlo", "monte_carlo_plus_sensitivity"):
        lines.append(f"## Headline metrics ({payload.get('iterations_run')} Monte Carlo iterations)")
        lines.append("")
        lines.append(
            "Two distinct intervals are reported for every metric. The **95% CI of "
            "the mean** is how precisely this run has pinned down the *average* "
            "outcome across iterations — it narrows as more iterations run. The "
            "**2.5th-97.5th percentile interval** is the spread a *single* "
            "12-month run (i.e. a single society, in a single year) would actually "
            "see — it does NOT narrow with more iterations, because it is a "
            "property of the underlying model, not of measurement precision. "
            "Quoting only the first kind of interval reads as near-certainty; the "
            "second kind is the one that matters for \"how much could this vary "
            "for us\"."
        )
        lines.append("")
        lines.append("| Metric | Mean | 95% CI of mean (low) | 95% CI of mean (high) | P2.5 (per-run) | P97.5 (per-run) | n |")
        lines.append("|---|---|---|---|---|---|---|")
        for name, summary in sorted(payload.get("metrics", {}).items()):
            lines.append(
                f"| {name} | {summary['mean']:.2f} | {summary['ci95_mean_low']:.2f} | {summary['ci95_mean_high']:.2f} "
                f"| {summary['p2_5']:.2f} | {summary['p97_5']:.2f} | {summary['n']} |"
            )
        lines.append("")

    for key, rows in payload.items():
        if key in ("kind", "iterations_run", "metrics"):
            continue
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            lines.append(f"## Sensitivity: {key}")
            lines.append("")
            headers = list(rows[0].keys())
            lines.append("| " + " | ".join(headers) + " |")
            lines.append("|" + "---|" * len(headers))
            for row in rows:
                lines.append("| " + " | ".join(f"{row[h]:.3f}" if isinstance(row[h], float) else str(row[h]) for h in headers) + " |")
            lines.append("")

    lines.append("## Functional-accuracy checks")
    lines.append("")
    lines.append("| Check | Passed | Detail |")
    lines.append("|---|---|---|")
    for c in functional_checks:
        lines.append(f"| {c.name} | {'PASS' if c.passed else 'FAIL'} | {c.detail} |")
    lines.append("")

    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


def _write_plots(scenario: str, payload: dict, raw_samples: dict | None, out_dir: Path) -> None:
    plt.rcParams.update({"figure.autolayout": True})

    if raw_samples:
        for name, values in raw_samples.items():
            if any(k in name for k in ("saving_pct", "saving_rs")) and "ht_bulk" not in name:
                fig, ax = plt.subplots(figsize=(6, 4))
                ax.hist(values, bins=30, color="#3b6fa0")
                ax.set_title(f"{scenario}: distribution of {name}")
                ax.set_xlabel(name)
                ax.set_ylabel("iterations")
                fig.savefig(out_dir / f"dist_{name}.png", dpi=120)
                plt.close(fig)

        if "collection_rate_pct" in raw_samples:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.hist(raw_samples["collection_rate_pct"], bins=30, color="#4a9d5f")
            ax.set_title("Collection-rate distribution")
            ax.set_xlabel("Collection rate (%)")
            ax.set_ylabel("iterations")
            fig.savefig(out_dir / "collection_rate_distribution.png", dpi=120)
            plt.close(fig)

    for key, rows in payload.items():
        if not (isinstance(rows, list) and rows and isinstance(rows[0], dict)):
            continue
        x_key = next(iter(rows[0].keys()))
        y_candidates = [k for k in rows[0].keys() if k.endswith("_mean") and ("saving" in k or "rate" in k)]
        if not y_candidates:
            y_candidates = [k for k in rows[0].keys() if k.endswith("_mean")][:1]
        for y_key in y_candidates[:2]:
            xs = [r[x_key] for r in rows]
            ys = [r.get(y_key) for r in rows]
            if any(y is None for y in ys):
                continue
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.plot(xs, ys, marker="o", color="#c0562d")
            ax.set_title(f"{scenario}: {y_key} vs {x_key}")
            ax.set_xlabel(x_key)
            ax.set_ylabel(y_key)
            fig.savefig(out_dir / f"sweep_{key}_{y_key}.png", dpi=120)
            plt.close(fig)

    if scenario == "corpus_sweep" and raw_samples:
        strategy_names = sorted({k[: -len("_shortfall_count")] for k in raw_samples if k.endswith("_shortfall_count")})
        colors = {"all_liquid": "#c0562d", "single_maturity": "#3b6fa0", "laddered": "#7a4fa3"}
        for strategy in strategy_names:
            values = raw_samples.get(f"{strategy}_shortfall_count")
            if not values:
                continue
            fig, ax = plt.subplots(figsize=(6, 4))
            bins = range(0, int(max(values)) + 2)
            ax.hist(values, bins=bins, color=colors.get(strategy, "#7a4fa3"), align="left", rwidth=0.8)
            ax.set_title(f"{strategy}: shortfall frequency (seasonal cash calls missed)")
            ax.set_xlabel("Shortfall count per 12-month run")
            ax.set_ylabel("iterations")
            fig.savefig(out_dir / f"fd_shortfall_frequency_{strategy}.png", dpi=120)
            plt.close(fig)

        interest_keys = [f"{s}_total_interest_earned_rs" for s in strategy_names if f"{s}_total_interest_earned_rs" in raw_samples]
        if interest_keys:
            fig, ax = plt.subplots(figsize=(6, 4))
            data = [raw_samples[k] for k in interest_keys]
            names = [k[: -len("_total_interest_earned_rs")] for k in interest_keys]
            ax.boxplot(data)
            ax.set_xticks(range(1, len(names) + 1))
            ax.set_xticklabels(names)
            ax.set_title("Interest earned by strategy (same random draws)")
            ax.set_ylabel("Interest earned (Rs)")
            fig.savefig(out_dir / "fd_strategy_interest_comparison.png", dpi=120)
            plt.close(fig)
