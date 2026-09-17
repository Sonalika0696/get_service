"""Scenario definitions. Each scenario is a function `(params) -> dict`
returning a JSON-serialisable payload consumed by `sim.analysis.report`.
Kept at the top level (alongside cli.py) rather than inside analysis/ or
engine/ since a scenario is an orchestration of synthetic + engine +
analysis pieces, not a piece of any one of them.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from sim.analysis.monte_carlo import run_until_stable
from sim.analysis.sensitivity import metrics_to_row, sweep, sweep_2d
from sim.config import SimParams
from sim.engine import collections as collections_engine
from sim.engine import electricity as electricity_engine
from sim.engine import requests as requests_engine
from sim.engine import treasury as treasury_engine
from sim.engine.water import blended_rate_per_kl
from sim.synthetic import consumption, society, water


# ---------------------------------------------------------------------------
# Per-iteration samplers (each returns a flat dict of scalar metrics for one
# Monte Carlo draw; consumed by sim.analysis.monte_carlo.run_until_stable)
# ---------------------------------------------------------------------------


def sample_ht_vs_lt(params: SimParams, rng: np.random.Generator) -> dict:
    flats = society.generate_society(params, rng)
    flat_consumption = consumption.generate_consumption(flats, params, rng)
    common_by_month = consumption.common_area_consumption(flat_consumption, params.common_area_load_fraction)

    flat_annual_kwh = flat_consumption.sum(axis=1).tolist()
    common_annual_kwh = float(common_by_month.sum())

    result = electricity_engine.compare_ht_vs_lt(
        flat_annual_kwh, common_annual_kwh, params.lt_tariff, params.ht_tariff, params.regulatory_margin_cap_fraction
    )
    return {
        "ht_bulk_total_rs": result.ht_bulk_total_paise / 100,
        "lt_aggregate_total_rs": result.lt_aggregate_total_paise / 100,
        "saving_rs": result.saving_paise / 100,
        "saving_pct": result.saving_pct,
        "recoverable_saving_rs": result.recoverable_saving_paise / 100,
    }


def sample_pooling(params: SimParams, rng: np.random.Generator) -> dict:
    out = {}
    total_saving = 0.0
    for cat in params.service_categories:
        outcome = requests_engine.form_pool(cat, params.n_flats, params.participation_rate, rng)
        out[f"{cat.name}_participants"] = outcome.participants
        out[f"{cat.name}_proceeded"] = 1.0 if outcome.proceeded else 0.0
        out[f"{cat.name}_saving_rs"] = outcome.aggregate_saving_vs_card
        total_saving += outcome.aggregate_saving_vs_card
    out["total_pooling_saving_rs"] = total_saving
    return out


def _draw_behaviours(params: SimParams, rng: np.random.Generator) -> list:
    names = [b.name for b in params.payment_behaviour_classes]
    weights = np.array([b.weight for b in params.payment_behaviour_classes])
    weights = weights / weights.sum()
    return list(rng.choice(names, p=weights, size=params.n_flats))


def sample_collections(params: SimParams, rng: np.random.Generator) -> dict:
    behaviours = _draw_behaviours(params, rng)
    outcomes = [collections_engine.simulate_flat_collections(b, params, rng) for b in behaviours]

    total_due = sum(o.total_due for o in outcomes)
    total_paid = sum(o.total_paid for o in outcomes)
    collection_rate = total_paid / total_due if total_due > 0 else 0.0
    mean_arrears_days = float(np.mean([o.max_arrears_days for o in outcomes]))
    pct_90_plus = float(np.mean([1.0 if o.max_arrears_days > 90 else 0.0 for o in outcomes]) * 100)
    pct_default_any_month = float(np.mean([1.0 if o.months_defaulted > 0 else 0.0 for o in outcomes]) * 100)
    total_late_fees = sum(o.total_late_fees for o in outcomes)

    return {
        "collection_rate_pct": collection_rate * 100,
        "mean_arrears_days": mean_arrears_days,
        "pct_flats_90_plus_days": pct_90_plus,
        "pct_flats_with_a_default_month": pct_default_any_month,
        "total_late_fees_rs": total_late_fees,
    }


def sample_water(params: SimParams, rng: np.random.Generator) -> dict:
    flats = society.generate_society(params, rng)
    demand = water.generate_water_demand(flats, params, rng)
    total_by_month = demand.sum(axis=0)
    sources = water.generate_source_mix(total_by_month, params, rng)
    rates = [blended_rate_per_kl(s).rate_paise_per_kl for s in sources]
    interrupted = sum(1 for s in sources if s.municipal_interrupted)

    return {
        "mean_rate_rs_per_kl": float(np.mean(rates)) / 100,
        "std_rate_rs_per_kl": float(np.std(rates)) / 100,
        "max_rate_rs_per_kl": float(np.max(rates)) / 100,
        "months_municipal_interrupted": interrupted,
    }


def sample_treasury(params: SimParams, rng: np.random.Generator) -> dict:
    """One Monte Carlo iteration for the corpus-sweep scenario: runs every
    configured treasury strategy (all_liquid / single_maturity / laddered)
    on the SAME collection-rate, cash-call and rate-drift draws (common
    random numbers — see engine/treasury.py), and flattens the per-strategy
    results into strategy-prefixed scalar metrics.
    """

    # Expected fraction of a month's dues EVENTUALLY collected (not merely
    # paid on time): per sim.engine.collections, a flat's dues are collected
    # in full unless that flat defaults outright for the month, regardless
    # of how late the (still fully due) payment arrives — so the right
    # center for the monthly collection-rate proxy is 1 - P(default),
    # weighted across behaviour classes, NOT the on-time probability (which
    # would wrongly treat "paid a month late" as "not collected" and
    # manufacture a structural deficit that has nothing to do with the
    # treasury strategy). Orchestrator review fix, alongside the
    # opex_fraction_of_dues change in engine/treasury.py.
    behaviour_default = {b.name: b.default_prob for b in params.payment_behaviour_classes}
    behaviour_weight = {b.name: b.weight for b in params.payment_behaviour_classes}
    expected_collection_fraction = sum((1 - behaviour_default[n]) * w for n, w in behaviour_weight.items())
    monthly_collection_rate = rng.normal(expected_collection_fraction, 0.02, size=params.horizon_months).clip(0.4, 1.0)

    result = treasury_engine.simulate_treasury(params, monthly_collection_rate, rng)

    out = {"structural_monthly_surplus_deficit_rs": result.structural_monthly_surplus_deficit_rs}
    for name, strategy_result in result.strategies.items():
        out[f"{name}_total_interest_earned_rs"] = strategy_result.total_interest_earned
        out[f"{name}_shortfall_count"] = strategy_result.shortfall_count
        out[f"{name}_met_via_premature_break_count"] = strategy_result.met_via_premature_break_count
        out[f"{name}_shortfall_rate_pct"] = strategy_result.shortfall_rate_pct
        out[f"{name}_prob_any_shortfall"] = strategy_result.any_shortfall
        out[f"{name}_ending_liquid_float_rs"] = strategy_result.ending_liquid_float
    return out


def sample_baseline(params: SimParams, rng: np.random.Generator) -> dict:
    """Combines every engine into one iteration for the headline baseline run."""

    out = {}
    out.update(sample_ht_vs_lt(params, rng))
    out.update(sample_pooling(params, rng))
    out.update(sample_collections(params, rng))
    out.update(sample_water(params, rng))
    out.update(sample_treasury(params, rng))
    return out


# ---------------------------------------------------------------------------
# Scenario registry: name -> (params) -> payload dict
# ---------------------------------------------------------------------------


def _mc_payload(params: SimParams, sample_fn) -> dict:
    result = run_until_stable(params, sample_fn)
    return {
        "kind": "monte_carlo",
        "iterations_run": result.iterations_run,
        "metrics": {name: vars(summary) for name, summary in result.metrics.items()},
        "raw_samples": result.raw_samples,
    }


def scenario_baseline(params: SimParams) -> dict:
    return _mc_payload(params, sample_baseline)


def scenario_ht_vs_lt(params: SimParams) -> dict:
    return _mc_payload(params, sample_ht_vs_lt)


def scenario_electricity_sensitivity(params: SimParams) -> dict:
    iterations_cap = 300  # bounded per grid point to keep runtime reasonable across many points
    tariff_diffs = [0.85, 0.90, 0.95, 1.00, 1.10, 1.20]  # multiplier applied to the HT energy rate relative to config

    diff_points = []
    for mult in tariff_diffs:
        scaled_slabs = tuple(replace(s, rate=s.rate * mult) for s in params.ht_tariff.slabs)
        scaled_tariff = replace(params.ht_tariff, slabs=scaled_slabs)
        p = replace(params, ht_tariff=scaled_tariff, mc_max_iterations=iterations_cap, mc_min_iterations=min(params.mc_min_iterations, iterations_cap))
        result = run_until_stable(p, sample_ht_vs_lt)
        diff_points.append({"ht_rate_multiplier": mult, "iterations": result.iterations_run, **metrics_to_row(result.metrics)})

    load_fractions = [0.05, 0.10, 0.14, 0.20, 0.30]
    load_points = sweep(params, "common_area_load_fraction", load_fractions, sample_ht_vs_lt, iterations_cap=iterations_cap)
    load_rows = [{"common_area_load_fraction": pt.param_value, "iterations": pt.result.iterations_run,
                  **metrics_to_row(pt.result.metrics)} for pt in load_points]

    margin_caps = [0.0, 0.01, 0.02, 0.03, 0.05, 0.08]
    margin_points = sweep(params, "regulatory_margin_cap_fraction", margin_caps, sample_ht_vs_lt, iterations_cap=iterations_cap)
    margin_rows = [{"regulatory_margin_cap_fraction": pt.param_value, "iterations": pt.result.iterations_run,
                    **metrics_to_row(pt.result.metrics)} for pt in margin_points]

    return {
        "kind": "sensitivity",
        "tariff_differential": diff_points,
        "common_area_load_fraction": load_rows,
        "regulatory_margin_cap": margin_rows,
    }


def scenario_pooling_aggregation(params: SimParams) -> dict:
    iterations_cap = 300
    participation_rates = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1.0]
    participation_points = sweep(params, "participation_rate", participation_rates, sample_pooling, iterations_cap=iterations_cap)
    participation_rows = [{"participation_rate": pt.param_value, "iterations": pt.result.iterations_run,
                           **metrics_to_row(pt.result.metrics)} for pt in participation_points]

    # Category-threshold sensitivity: vary the bulk_grocery category's threshold explicitly (it is not a top-level
    # SimParams field, so this loop constructs the modified service_categories tuple by hand rather than using sweep()).
    # Orchestrator review fix: the original threshold grid (5-40) never
    # exceeded typical participation (~49.5 of 90 flats at the default 0.55
    # participation rate), so every pool always cleared and the threshold
    # dimension was untested (proceeded stayed at ~1.0 throughout). This
    # grid extends well past the typical participant count so the pool
    # visibly LAPSES (proceeded << 1.0, saving -> 0) at the high end.
    threshold_rows = []
    thresholds = [5, 10, 15, 25, 40, 55, 65, 80]
    for t in thresholds:
        new_categories = tuple(
            replace(c, threshold=t) if c.name == "bulk_grocery" else c for c in params.service_categories
        )
        p = replace(params, service_categories=new_categories, mc_max_iterations=iterations_cap, mc_min_iterations=min(params.mc_min_iterations, iterations_cap))
        result = run_until_stable(p, sample_pooling)
        row = {"bulk_grocery_threshold": t, "iterations": result.iterations_run}
        bulk_grocery_metrics = {k: v for k, v in result.metrics.items() if k.startswith("bulk_grocery")}
        row.update(metrics_to_row(bulk_grocery_metrics))
        threshold_rows.append(row)

    return {
        "kind": "sensitivity",
        "participation_rate": participation_rows,
        "bulk_grocery_threshold": threshold_rows,
    }


def scenario_collections(params: SimParams) -> dict:
    return _mc_payload(params, sample_collections)


def scenario_water_volatility(params: SimParams) -> dict:
    baseline_payload = _mc_payload(params, sample_water)

    iterations_cap = 300
    interruption_probs = [0.0, 0.03, 0.06, 0.12, 0.20, 0.35]
    points = sweep(params, "municipal_interruption_prob", interruption_probs, sample_water, iterations_cap=iterations_cap)
    rows = [{"municipal_interruption_prob": pt.param_value, "iterations": pt.result.iterations_run,
             **metrics_to_row(pt.result.metrics)} for pt in points]

    baseline_payload["kind"] = "monte_carlo_plus_sensitivity"
    baseline_payload["interruption_sensitivity"] = rows
    return baseline_payload


def scenario_corpus_sweep(params: SimParams) -> dict:
    baseline_payload = _mc_payload(params, sample_treasury)

    iterations_cap = 300
    corpus_months = [3.0, 4.5, 6.0, 8.0, 10.0, 12.0]
    corpus_points = sweep(params, "corpus_starting_months_of_dues", corpus_months, sample_treasury, iterations_cap=iterations_cap)
    corpus_rows = [{"corpus_starting_months_of_dues": pt.param_value, "iterations": pt.result.iterations_run,
                    **metrics_to_row(pt.result.metrics)} for pt in corpus_points]

    float_floor_months = [0.5, 1.0, 2.0, 3.0, 4.0]
    float_points = sweep(params, "operating_float_floor_months", float_floor_months, sample_treasury, iterations_cap=iterations_cap)
    float_rows = [{"operating_float_floor_months": pt.param_value, "iterations": pt.result.iterations_run,
                   **metrics_to_row(pt.result.metrics)} for pt in float_points]

    baseline_payload["kind"] = "monte_carlo_plus_sensitivity"
    baseline_payload["corpus_size_sensitivity"] = corpus_rows
    baseline_payload["float_floor_sensitivity"] = float_rows
    return baseline_payload


REGISTRY = {
    "baseline": scenario_baseline,
    "ht_vs_lt": scenario_ht_vs_lt,
    "electricity_sensitivity": scenario_electricity_sensitivity,
    "pooling_aggregation": scenario_pooling_aggregation,
    "collections": scenario_collections,
    "water_volatility": scenario_water_volatility,
    "corpus_sweep": scenario_corpus_sweep,
}


def run_scenario(name: str, params: SimParams) -> dict:
    if name not in REGISTRY:
        raise ValueError(f"Unknown scenario {name!r}. Known scenarios: {sorted(REGISTRY)}")
    return REGISTRY[name](params)
