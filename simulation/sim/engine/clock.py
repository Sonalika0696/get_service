"""Discrete-month simulation clock: a single-iteration run of the full
12-month society model, tying synthetic generators to the engine modules.
One call to `run_iteration` = one Monte Carlo draw.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import SimParams
from sim.engine import collections as collections_engine
from sim.engine import electricity as electricity_engine
from sim.engine import requests as requests_engine
from sim.synthetic import consumption, residents, society, water


@dataclass(frozen=True)
class IterationResult:
    ht_vs_lt: electricity_engine.HtVsLtResult
    pool_outcomes: tuple
    collection_outcomes: tuple
    monthly_collection_rate: np.ndarray
    water_sources: tuple
    water_blended_rate_paise_per_kl: tuple  # per month


def run_iteration(params: SimParams, rng: np.random.Generator) -> IterationResult:
    flats = society.generate_society(params, rng)
    residents_list = residents.generate_residents(flats, params, rng)

    flat_consumption = consumption.generate_consumption(flats, params, rng)  # (n_flats, months)
    common_area_by_month = consumption.common_area_consumption(flat_consumption, params.common_area_load_fraction)
    # Principal HT-vs-LT result uses the ANNUAL totals (12-month horizon), matching "twelve-month horizon" checklist item.
    flat_annual_kwh = flat_consumption.sum(axis=1).tolist()
    common_annual_kwh = float(common_area_by_month.sum())
    ht_vs_lt = electricity_engine.compare_ht_vs_lt(
        flat_annual_kwh, common_annual_kwh, params.lt_tariff, params.ht_tariff, params.regulatory_margin_cap_fraction
    )

    water_demand = water.generate_water_demand(flats, params, rng)
    total_water_by_month = water_demand.sum(axis=0)
    water_sources = water.generate_source_mix(total_water_by_month, params, rng)
    water_rates = []
    for src in water_sources:
        from sim.engine.water import blended_rate_per_kl

        water_rates.append(blended_rate_per_kl(src))

    pool_outcomes = tuple(
        requests_engine.form_pool(cat, params.n_flats, params.participation_rate, rng) for cat in params.service_categories
    )

    collection_outcomes = tuple(
        collections_engine.simulate_flat_collections(r.payment_behaviour, params, rng) for r in residents_list
    )
    monthly_dues_total = params.monthly_due_per_flat * params.n_flats
    # Reconstruct an approximate month-by-month collection rate for the treasury engine
    # from the same behaviour draws (illustrative aggregate, not a full per-month replay).
    behaviour_on_time = {b.name: b.on_time_prob for b in params.payment_behaviour_classes}
    behaviour_weight = {r.payment_behaviour: 0 for r in residents_list}
    for r in residents_list:
        behaviour_weight[r.payment_behaviour] = behaviour_weight.get(r.payment_behaviour, 0) + 1
    avg_on_time = sum(behaviour_on_time[b] * w for b, w in behaviour_weight.items()) / params.n_flats
    monthly_collection_rate = rng.normal(avg_on_time, 0.03, size=params.horizon_months).clip(0.5, 1.0)

    return IterationResult(
        ht_vs_lt=ht_vs_lt,
        pool_outcomes=pool_outcomes,
        collection_outcomes=collection_outcomes,
        monthly_collection_rate=monthly_collection_rate,
        water_sources=tuple(water_sources),
        water_blended_rate_paise_per_kl=tuple(r.rate_paise_per_kl for r in water_rates),
    )
