"""Monte Carlo driver: runs a scenario's per-iteration sampler until the
reported 95% confidence intervals stabilise (Phase 13 checklist item 1),
or a maximum iteration cap is hit, and reports means + 95% CIs for every
tracked scalar metric.

Reproducibility: iterations are seeded from `numpy.random.SeedSequence(seed).spawn(n)`,
so the exact same `seed` always produces the exact same sequence of
per-iteration RNG streams regardless of how many iterations are ultimately
run (adding more iterations never perturbs earlier ones).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

from sim.config import SimParams

SampleFn = Callable[[SimParams, np.random.Generator], dict]


@dataclass(frozen=True)
class MetricSummary:
    mean: float
    std: float
    ci95_low: float
    ci95_high: float
    n: int


@dataclass(frozen=True)
class MonteCarloResult:
    iterations_run: int
    metrics: dict  # name -> MetricSummary
    raw_samples: dict  # name -> list[float], for plotting


def _summarise(samples: list[float]) -> MetricSummary:
    arr = np.asarray(samples, dtype=float)
    n = len(arr)
    mean = float(arr.mean())
    std = float(arr.std(ddof=1)) if n > 1 else 0.0
    half_width = 1.96 * std / np.sqrt(n) if n > 1 else 0.0
    return MetricSummary(mean=mean, std=std, ci95_low=mean - half_width, ci95_high=mean + half_width, n=n)


def run_until_stable(params: SimParams, sample_fn: SampleFn) -> MonteCarloResult:
    seed_seq = np.random.SeedSequence(params.seed)
    max_n = params.mc_max_iterations
    child_seeds = seed_seq.spawn(max_n)

    samples: dict[str, list[float]] = {}
    n_run = 0

    for i in range(max_n):
        rng = np.random.default_rng(child_seeds[i])
        result = sample_fn(params, rng)
        for key, value in result.items():
            samples.setdefault(key, []).append(float(value))
        n_run += 1

        if n_run >= params.mc_min_iterations and n_run % params.mc_check_every == 0:
            if _is_stable(samples, params.mc_stability_rel_tol):
                break

    metrics = {name: _summarise(vals) for name, vals in samples.items()}
    return MonteCarloResult(iterations_run=n_run, metrics=metrics, raw_samples=samples)


def _is_stable(samples: dict, rel_tol: float) -> bool:
    for vals in samples.values():
        summary = _summarise(vals)
        half_width = summary.ci95_high - summary.mean
        denom = abs(summary.mean)
        rel = half_width / denom if denom > 1e-9 else half_width
        if rel > rel_tol:
            return False
    return True
