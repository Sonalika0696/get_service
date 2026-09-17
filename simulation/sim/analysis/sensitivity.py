"""Parameter sweeps for the sensitivity scenarios (Phase 13 checklist item 3
and 4): re-runs a bounded Monte Carlo at each grid point and returns a table
of (parameter value -> metric mean + 95% CI).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable

from sim.analysis.monte_carlo import MonteCarloResult, run_until_stable
from sim.config import SimParams


@dataclass(frozen=True)
class SweepPoint:
    param_value: float
    result: MonteCarloResult


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
            for name, summary in result.metrics.items():
                row[f"{name}_mean"] = summary.mean
                row[f"{name}_ci_low"] = summary.ci95_low
                row[f"{name}_ci_high"] = summary.ci95_high
            rows.append(row)
    return rows
