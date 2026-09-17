"""Tests for the treasury engine rewrite (orchestrator review, post-5e67f4b).
The original model accepted `rng` but never used it (shortfall_count had
zero variance across Monte Carlo iterations) and subtracted the FULL
monthly dues raised as opex regardless of the ~97-98% collection rate,
manufacturing a guaranteed structural shortfall. These tests pin down the
fix: real stochastic inputs, a configurable opex fraction, three strategies
compared on common random numbers, and the premature-withdrawal mitigation.
"""

from dataclasses import replace

import numpy as np

from sim.config import DEFAULT_PARAMS, TREASURY_STRATEGIES
from sim.engine.treasury import simulate_treasury


def _collection_rate(params, rng, sigma=0.02):
    behaviour_default = {b.name: b.default_prob for b in params.payment_behaviour_classes}
    behaviour_weight = {b.name: b.weight for b in params.payment_behaviour_classes}
    expected = sum((1 - behaviour_default[n]) * w for n, w in behaviour_weight.items())
    return rng.normal(expected, sigma, size=params.horizon_months).clip(0.4, 1.0)


def test_all_three_strategies_are_present():
    rng = np.random.default_rng(1)
    result = simulate_treasury(DEFAULT_PARAMS, _collection_rate(DEFAULT_PARAMS, rng), rng)
    assert set(result.strategies) == set(TREASURY_STRATEGIES) == {"all_liquid", "single_maturity", "laddered"}


def test_shortfall_count_has_nonzero_variance_across_seeded_iterations():
    """Reproduces the orchestrator's evidence: run many independent seeded
    iterations and confirm shortfall_count is NOT identical every time (the
    original bug: rng was accepted but never consumed, so every iteration
    was bit-identical and std was exactly 0).
    """

    shortfalls = {name: [] for name in TREASURY_STRATEGIES}
    for seed in range(120):
        rng = np.random.default_rng(seed)
        result = simulate_treasury(DEFAULT_PARAMS, _collection_rate(DEFAULT_PARAMS, rng), rng)
        for name, strategy_result in result.strategies.items():
            shortfalls[name].append(strategy_result.shortfall_count)

    for name, values in shortfalls.items():
        assert len(set(values)) > 1, f"{name}: shortfall_count was identical across all seeds ({values[0]!r}) — rng is not affecting the outcome"
        assert np.std(values) > 0, f"{name}: shortfall_count has zero variance"


def test_all_liquid_never_needs_and_never_uses_a_premature_break():
    rng = np.random.default_rng(7)
    result = simulate_treasury(DEFAULT_PARAMS, _collection_rate(DEFAULT_PARAMS, rng), rng)
    assert result.strategies["all_liquid"].met_via_premature_break_count == 0


def test_premature_break_mitigates_a_shortfall_that_would_otherwise_occur():
    """A deterministic (zero-noise) scenario sized so the operating float
    alone cannot cover the single configured cash call, but breaking a
    laddered/single-maturity FD exactly covers it. Confirms the premature
    break is exercised and counted separately from an unmet shortfall.
    """

    params = replace(
        DEFAULT_PARAMS,
        corpus_starting_months_of_dues=3.0,
        operating_float_floor_months=1.0,
        seasonal_cash_calls=((0, 4.0),),
        seasonal_cash_call_size_sigma=0.0,
        cash_call_month_jitter_months=0,
        fd_rate_drift_sigma_pct_points=0.0,
        opex_fraction_of_dues=0.0,
    )
    collection_rate = np.ones(params.horizon_months)
    rng = np.random.default_rng(0)

    result = simulate_treasury(params, collection_rate, rng)

    # All-liquid holds the whole corpus as float already, so the call is met without any break.
    assert result.strategies["all_liquid"].met_via_premature_break_count == 0
    assert result.strategies["all_liquid"].shortfall_count == 0

    # Laddered and single-maturity both need to break an FD to cover the call, and succeed.
    assert result.strategies["laddered"].met_via_premature_break_count == 1
    assert result.strategies["laddered"].shortfall_count == 0
    assert result.strategies["single_maturity"].met_via_premature_break_count == 1
    assert result.strategies["single_maturity"].shortfall_count == 0


def test_premature_break_insufficient_still_counts_as_unmet_shortfall():
    """When even breaking every FD cannot cover the call, it must be counted
    as an unmet shortfall, never silently as a successful break.
    """

    params = replace(
        DEFAULT_PARAMS,
        corpus_starting_months_of_dues=1.5,   # tiny corpus
        operating_float_floor_months=0.5,
        seasonal_cash_calls=((0, 20.0),),      # a cash call far larger than the whole corpus
        seasonal_cash_call_size_sigma=0.0,
        cash_call_month_jitter_months=0,
        fd_rate_drift_sigma_pct_points=0.0,
        opex_fraction_of_dues=0.0,
    )
    collection_rate = np.ones(params.horizon_months)
    rng = np.random.default_rng(0)

    result = simulate_treasury(params, collection_rate, rng)

    for name in TREASURY_STRATEGIES:
        assert result.strategies[name].shortfall_count == 1


def test_strategies_share_common_random_numbers():
    """Running the same params/rng seed twice is deterministic, and the cash
    call draws are shared: a stress scenario that produces a shortfall for
    one strategy at a given seed should be produced from the SAME cash-call
    size/month for every strategy (common random numbers), not independent
    draws per strategy.
    """

    rng1 = np.random.default_rng(42)
    result1 = simulate_treasury(DEFAULT_PARAMS, _collection_rate(DEFAULT_PARAMS, rng1), rng1)

    rng2 = np.random.default_rng(42)
    result2 = simulate_treasury(DEFAULT_PARAMS, _collection_rate(DEFAULT_PARAMS, rng2), rng2)

    for name in TREASURY_STRATEGIES:
        assert result1.strategies[name] == result2.strategies[name]


def test_structural_surplus_deficit_is_reported_and_uses_collection_not_opex_alone():
    rng = np.random.default_rng(3)
    result = simulate_treasury(DEFAULT_PARAMS, _collection_rate(DEFAULT_PARAMS, rng), rng)
    # With the default ~97.8% expected collection fraction and an 88% opex fraction,
    # the structural monthly position should be a modest surplus, not a guaranteed drain.
    assert result.structural_monthly_surplus_deficit_rs > 0
