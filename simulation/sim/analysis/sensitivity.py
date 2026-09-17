"""Parameter sweeps for the sensitivity scenarios (Phase 13 checklist item 3
and 4): re-runs a bounded Monte Carlo at each grid point and returns a table
of (parameter value -> metric mean, 95% CI of the mean, AND the 2.5-97.5th
percentile interval of the per-iteration distribution — see
sim/analysis/monte_carlo.py's module docstring for why both are reported).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable

from sim.analysis.monte_carlo import MetricSummary, MonteCarloResult, run_until_stable
from sim.config import SimParams


@dataclass(frozen=True)
class SweepPoint:
    param_value: float
    result: MonteCarloResult


def metrics_to_row(metrics: dict) -> dict:
    """Flattens a {name: MetricSummary} dict into a single row dict with
    `{name}_mean`, `{name}_ci95_mean_low/high` and `{name}_p2_5`/`p97_5`
    columns for every metric — the one place this flattening happens, so
    every sweep table reports both interval types identically.
    """

    row: dict = {}
    for name, summary in metrics.items():
        s: MetricSummary = summary
        row[f"{name}_mean"] = s.mean
        row[f"{name}_ci95_mean_low"] = s.ci95_mean_low
        row[f"{name}_ci95_mean_high"] = s.ci95_mean_high
        row[f"{name}_p2_5"] = s.p2_5
        row[f"{name}_p97_5"] = s.p97_5
    return row


def sweep(base_params: SimParams, param_name: str, values: list, sample_fn: Callable, iterations_cap: int | None = None) -> list[SweepPoint]:
    """Re-runs Monte Carlo for `base_params` with `param_name` set to each of
    `values` in turn. `iterations_cap` bounds runtime for sweeps with many
    grid points (defaults to base_params.mc_max_iterations if not given).
    """

    points = []
    for v in values:
        overrides = {param_name: v}
        if iterations_cap is not None:
            overrides["mc_max_iterations"] = iterations_cap
            overrides["mc_min_iterations"] = min(base_params.mc_min_iterations, iterations_cap)
        params = replace(base_params, **overrides)
        result = run_until_stable(params, sample_fn)
        points.append(SweepPoint(param_value=v, result=result))
    return points


def sweep_2d(base_params: SimParams, param_a: str, values_a: list, param_b: str, values_b: list, sample_fn: Callable, iterations_cap: int | None = None) -> list[dict]:
    """Cartesian-product sweep over two parameters; returns a flat list of
    dict rows suitable for a pandas DataFrame / CSV.
    """

    rows = []
    for a in values_a:
        for b in values_b:
            overrides = {param_a: a, param_b: b}
            if iterations_cap is not None:
                overrides["mc_max_iterations"] = iterations_cap
                overrides["mc_min_iterations"] = min(base_params.mc_min_iterations, iterations_cap)
            params = replace(base_params, **overrides)
            result = run_until_stable(params, sample_fn)
            row = {param_a: a, param_b: b, "iterations": result.iterations_run}
            row.update(metrics_to_row(result.metrics))
            rows.append(row)
    return rows
