"""Corpus sweep / laddered fixed-deposit yield vs seasonal liquidity risk
(Phase 13 checklist item 7): how often does a laddered FD maturity profile
fail to meet a seasonal cash call, given an operating float floor and
month-to-month variability in collections feeding the float — compared
against two simpler strategies on the SAME random draws, so the comparison
is not confounded by different random luck.

Orchestrator review (post-5e67f4b) found the original single-strategy model
was a statistical artefact: `rng` was accepted but never used (so every
Monte Carlo iteration was identical — shortfall_count had zero variance),
and `liquid_float -= monthly_dues_total` subtracted the FULL amount raised
every month regardless of the ~97-98% collection rate, which manufactured a
structural ~2%/month float drain that guaranteed a shortfall regardless of
the ladder. This rewrite:

  1. Draws real stochastic inputs from `rng`: each seasonal cash call's
     SIZE (log-normal around its configured multiple) and MONTH (jittered
     +/- a configurable number of months), and FD rate drift at every
     rollover (see sim/config.py SEASONAL_CASH_CALL_SIZE_SIGMA,
     CASH_CALL_MONTH_JITTER_MONTHS, FD_RATE_DRIFT_SIGMA_PCT_POINTS).
  2. Replaces the opex outflow with `monthly_dues_total *
     opex_fraction_of_dues` (config.OPEX_FRACTION_OF_DUES, illustrative
     ~0.88), and reports the resulting structural monthly surplus/deficit
     explicitly, so a reader can see whether the society is solvent on
     paper before attributing any shortfall to the investment strategy.
  3. Compares three strategies on IDENTICAL random draws (common random
     numbers): ALL_LIQUID (no FDs, everything at a liquid savings rate),
     SINGLE_MATURITY (the whole investable corpus in one tenor), and
     LADDERED (the original multi-rung ladder).
  4. Models premature FD withdrawal as a real mitigation: when a cash call
     cannot be met from the liquid float, a strategy may break its
     soonest-maturing FD at a configurable rate penalty (floored at 0),
     tracked separately from an outright unmet shortfall.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import SimParams


@dataclass
class _Rung:
    tenor_months: int
    rate_pct: float
    principal: float
    maturity_month: int
    invested_since_month: int


@dataclass(frozen=True)
class TreasuryStrategyResult:
    strategy: str
    total_interest_earned: float
    shortfall_count: int  # cash calls unmet even after every available premature break was attempted
    met_via_premature_break_count: int  # cash calls that would have been unmet from the float alone, but were met by breaking an FD early
    shortfall_rate_pct: float  # shortfall_count / number of configured seasonal cash calls
    any_shortfall: float  # 1.0 if shortfall_count > 0 this run, else 0.0 — averaging this over Monte Carlo iterations gives P(>=1 shortfall/year)
    ending_liquid_float: float


@dataclass(frozen=True)
class TreasuryRunResult:
    strategies: dict  # strategy name -> TreasuryStrategyResult
    structural_monthly_surplus_deficit_rs: float  # monthly_dues_total * (mean collection rate - opex_fraction_of_dues); same for every strategy, a diagnostic independent of the investment choice


def _draw_common_random_inputs(params: SimParams, months: int, monthly_dues_total: float, rng: np.random.Generator):
    """The random draws shared across ALL strategies for one Monte Carlo
    iteration (common random numbers), so differences between strategies'
    outcomes reflect the strategy, not different luck.
    """

    rate_drift_by_month = rng.normal(0.0, params.fd_rate_drift_sigma_pct_points, size=months)

    cash_calls_by_month: dict[int, list[float]] = {}
    jitter = params.cash_call_month_jitter_months
    for month, multiple in params.seasonal_cash_calls:
        month_shift = int(rng.integers(-jitter, jitter + 1)) if jitter > 0 else 0
        actual_month = min(max(month + month_shift, 0), months - 1)
        size_sigma = params.seasonal_cash_call_size_sigma
        size_factor = float(rng.lognormal(mean=-0.5 * size_sigma**2, sigma=size_sigma)) if size_sigma > 0 else 1.0
        amount = multiple * monthly_dues_total * size_factor
        cash_calls_by_month.setdefault(actual_month, []).append(amount)

    return rate_drift_by_month, cash_calls_by_month


def _make_rungs(strategy: str, params: SimParams, investable: float) -> list:
    if strategy == "all_liquid":
        return []  # nothing locked up; `investable` is folded into the starting liquid float by the caller
    if strategy == "single_maturity":
        longest = max(params.fd_ladder, key=lambda t: t.tenor_months)
        return [_Rung(tenor_months=longest.tenor_months, rate_pct=longest.annual_rate_pct, principal=investable, maturity_month=longest.tenor_months, invested_since_month=0)]
    if strategy == "laddered":
        n = len(params.fd_ladder)
        principal_per_rung = investable / n if n > 0 else 0.0
        return [
            _Rung(tenor_months=t.tenor_months, rate_pct=t.annual_rate_pct, principal=principal_per_rung, maturity_month=t.tenor_months, invested_since_month=0)
            for t in params.fd_ladder
        ]
    raise ValueError(f"unknown treasury strategy {strategy!r}")


def _run_one_strategy(
    strategy: str,
    params: SimParams,
    months: int,
    monthly_dues_total: float,
    float_floor: float,
    investable: float,
    collection_rate_by_month: np.ndarray,
    rate_drift_by_month: np.ndarray,
    cash_calls_by_month: dict,
) -> TreasuryStrategyResult:
    rungs = _make_rungs(strategy, params, investable)
    liquid_float = float_floor + investable if strategy == "all_liquid" else float_floor

    total_interest = 0.0
    shortfall_count = 0
    met_via_break_count = 0
    savings_monthly_rate = params.liquid_savings_rate_pct / 100.0 / 12.0

    for m in range(months):
        collected = monthly_dues_total * float(collection_rate_by_month[m])
        liquid_float += collected
        liquid_float -= monthly_dues_total * params.opex_fraction_of_dues

        if liquid_float > 0:
            liquid_float += liquid_float * savings_monthly_rate

        for rung in rungs:
            if rung.maturity_month != m:
                continue
            interest = rung.principal * (rung.rate_pct / 100.0 / 12.0) * rung.tenor_months
            total_interest += interest
            liquid_float += rung.principal + interest
            # Reinvest the same nominal principal for another cycle of the same tenor, at the drifted rate.
            new_rate = max(0.0, rung.rate_pct + rate_drift_by_month[m])
            liquid_float -= rung.principal
            rung.rate_pct = new_rate
            rung.maturity_month = m + rung.tenor_months
            rung.invested_since_month = m

        calls_this_month = cash_calls_by_month.get(m)
        if not calls_this_month:
            continue

        needed = sum(calls_this_month)
        if liquid_float >= needed:
            liquid_float -= needed
            continue

        shortfall = needed - liquid_float
        liquid_float = 0.0
        used_a_break = False

        for rung in sorted(rungs, key=lambda r: r.maturity_month):
            if shortfall <= 1e-9:
                break
            days_held = max(0, (m - rung.invested_since_month)) * 30
            effective_rate = max(0.0, rung.rate_pct - params.premature_withdrawal_penalty_pct_points)
            partial_interest = rung.principal * (effective_rate / 100.0) * (days_held / 365.0)
            proceeds = rung.principal + partial_interest
            total_interest += partial_interest

            use_now = min(shortfall, proceeds)
            shortfall -= use_now
            remaining = proceeds - use_now
            used_a_break = True

            new_rate = max(0.0, rung.rate_pct + rate_drift_by_month[m])
            rung.principal = remaining
            rung.rate_pct = new_rate
            rung.maturity_month = m + rung.tenor_months
            rung.invested_since_month = m

        if shortfall <= 1e-9:
            if used_a_break:
                met_via_break_count += 1
        else:
            shortfall_count += 1

    n_calls = max(1, len(params.seasonal_cash_calls))
    return TreasuryStrategyResult(
        strategy=strategy,
        total_interest_earned=total_interest,
        shortfall_count=shortfall_count,
        met_via_premature_break_count=met_via_break_count,
        shortfall_rate_pct=(shortfall_count / n_calls) * 100.0,
        any_shortfall=1.0 if shortfall_count > 0 else 0.0,
        ending_liquid_float=liquid_float,
    )


def simulate_treasury(params: SimParams, collection_rate_by_month: np.ndarray, rng: np.random.Generator) -> TreasuryRunResult:
    """Runs every strategy in `params.treasury_strategies` for one Monte
    Carlo iteration, sharing the same random draws (collections, cash-call
    size/month jitter, FD rate drift) across all of them.
    """

    months = params.horizon_months
    monthly_dues_total = params.monthly_due_per_flat * params.n_flats
    corpus = params.corpus_starting_months_of_dues * monthly_dues_total
    float_floor = params.operating_float_floor_months * monthly_dues_total
    investable = max(0.0, corpus - float_floor)

    rate_drift_by_month, cash_calls_by_month = _draw_common_random_inputs(params, months, monthly_dues_total, rng)

    strategies = {}
    for strategy in params.treasury_strategies:
        strategies[strategy] = _run_one_strategy(
            strategy, params, months, monthly_dues_total, float_floor, investable,
            collection_rate_by_month, rate_drift_by_month, cash_calls_by_month,
        )

    structural = monthly_dues_total * (float(np.mean(collection_rate_by_month)) - params.opex_fraction_of_dues)

    return TreasuryRunResult(strategies=strategies, structural_monthly_surplus_deficit_rs=structural)
