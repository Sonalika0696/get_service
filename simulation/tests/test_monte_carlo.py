"""Tests for the Monte Carlo summary statistics (orchestrator review,
post-5e67f4b): every metric must report BOTH the 95% CI of the mean and the
2.5th-97.5th percentile interval of the per-iteration distribution, clearly
and separately labelled.
"""

from dataclasses import replace

import numpy as np

from sim.analysis.monte_carlo import MetricSummary, _summarise, run_until_stable
from sim.config import DEFAULT_PARAMS


def test_metric_summary_has_both_interval_types_distinctly_labelled():
    fields = MetricSummary.__dataclass_fields__.keys()
    assert {"mean", "std", "ci95_mean_low", "ci95_mean_high", "p2_5", "p97_5", "n"} <= set(fields)


def test_percentile_interval_is_wider_than_ci_of_the_mean_for_many_iterations():
    """The whole point of reporting both: with enough iterations the CI of
    the mean becomes very narrow while the per-iteration spread does not.
    """

    rng = np.random.default_rng(0)
    samples = list(rng.normal(100.0, 10.0, size=5000))
    summary = _summarise(samples)

    ci_width = summary.ci95_mean_high - summary.ci95_mean_low
    percentile_width = summary.p97_5 - summary.p2_5

    assert percentile_width > ci_width * 10  # percentile interval should be MUCH wider at n=5000
    # Sanity: percentile interval for a N(100, 10) sample should be roughly [80, 120].
    assert 75 < summary.p2_5 < 85
    assert 115 < summary.p97_5 < 125


def test_percentile_interval_does_not_collapse_with_more_iterations_but_ci_does():
    rng = np.random.default_rng(0)
    small = _summarise(list(rng.normal(50.0, 5.0, size=30)))
    rng2 = np.random.default_rng(0)
    large = _summarise(list(rng2.normal(50.0, 5.0, size=5000)))

    small_ci_width = small.ci95_mean_high - small.ci95_mean_low
    large_ci_width = large.ci95_mean_high - large.ci95_mean_low
    assert large_ci_width < small_ci_width / 3  # CI of the mean shrinks sharply with n

    small_pct_width = small.p97_5 - small.p2_5
    large_pct_width = large.p97_5 - large.p2_5
    assert abs(large_pct_width - small_pct_width) < 8.0  # percentile spread is roughly stable with n (some sampling noise expected at n=30)


def test_run_until_stable_reports_both_interval_types_for_a_real_scenario():
    def sample_fn(params, rng):
        return {"x": float(rng.normal(10.0, 2.0))}

    params = replace(DEFAULT_PARAMS, mc_min_iterations=100, mc_max_iterations=500, mc_check_every=50)
    result = run_until_stable(params, sample_fn)
    summary = result.metrics["x"]

    assert summary.ci95_mean_high > summary.ci95_mean_low
    assert summary.p97_5 > summary.p2_5
    # Percentile interval must be visibly wider than the CI of the mean (the whole point of the fix).
    assert (summary.p97_5 - summary.p2_5) > (summary.ci95_mean_high - summary.ci95_mean_low)
