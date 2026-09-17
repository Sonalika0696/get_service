"""Monte Carlo driver: runs a scenario's per-iteration sampler until the
reported 95% confidence intervals stabilise (Phase 13 checklist item 1),
or a maximum iteration cap is hit, and reports, for every tracked scalar
metric, BOTH:

  - the 95% CI of the MEAN (`ci95_mean_low` / `ci95_mean_high`) — how
    precisely this Monte Carlo run has pinned down the *average* outcome
    across iterations, which shrinks toward zero width as more iterations
    are run; and
  - the 2.5th-97.5th PERCENTILE INTERVAL of the per-iteration distribution
    (`p2_5` / `p97_5`) — the actual SPREAD a single society would face in
    any one year, which does NOT shrink with more iterations (it is a
    property of the underlying model, not of how precisely we've measured
    its mean).

Orchestrator review (post-5e67f4b) flagged that reporting only the CI of
the mean reads as "the saving is nearly certain" when the per-iteration
spread is materially wider; both intervals are now computed by the same
`_summarise` call and both are written to every artefact (results.json,
report.md), never just one.

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
    ci95_mean_low: float  # 95% CI of the MEAN: precision of the estimated average, shrinks with more iterations
    ci95_mean_high: float
    p2_5: float  # 2.5th percentile of the PER-ITERATION distribution: the spread a single run/society actually faces
    p97_5: float  # 97.5th percentile of the per-iteration distribution
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
    if n > 1:
        p2_5 = float(np.percentile(arr, 2.5))
        p97_5 = float(np.percentile(arr, 97.5))
    else:
        p2_5 = mean
        p97_5 = mean
    return MetricSummary(
        mean=mean,
        std=std,
        ci95_mean_low=mean - half_width,
        ci95_mean_high=mean + half_width,
        p2_5=p2_5,
        p97_5=p97_5,
        n=n,
    )


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
    """Stability is judged on the CI-of-the-mean half-width only (the
    percentile interval is a property of the model, not of how many
    iterations have run, and is not expected to shrink further)."""

    for vals in samples.values():
        summary = _summarise(vals)
        half_width = summary.ci95_mean_high - summary.mean
        denom = abs(summary.mean)
        rel = half_width / denom if denom > 1e-9 else half_width
        if rel > rel_tol:
            return False
    return True
