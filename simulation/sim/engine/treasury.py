"""Corpus sweep / laddered fixed-deposit yield vs seasonal liquidity risk
(Phase 13 checklist item 7): how often does a laddered FD maturity profile
fail to meet a seasonal cash call, given an operating float floor and
month-to-month variability in collections feeding the float?
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import FdTranche, SimParams


@dataclass(frozen=True)
class TreasuryRunResult:
    total_interest_earned: float
    shortfall_months: tuple  # month indices where a seasonal cash call could not be met from float + maturing FDs
    shortfall_count: int
    ending_liquid_float: float


def simulate_treasury(params: SimParams, collection_rate_by_month: np.ndarray, rng: np.random.Generator) -> TreasuryRunResult:
    """`collection_rate_by_month` (len == horizon_months) is the fraction of
    MONTHLY_DUE_PER_FLAT * n_flats actually collected that month (feeds
    variability from the collections engine into the treasury's operating
    float, rather than assuming 100% collection).
    """

    months = params.horizon_months
    monthly_dues_total = params.monthly_due_per_flat * params.n_flats
    corpus = params.corpus_starting_months_of_dues * monthly_dues_total
    float_floor = params.operating_float_floor_months * monthly_dues_total

    # Split the starting corpus evenly across the FD ladder's rungs; each
    # rung matures every `tenor_months` and is immediately re-laddered
    # (rolled) at the then-current rate for the same tenor.
    ladder: list[FdTranche] = list(params.fd_ladder)
    n_rungs = len(ladder)
    principal_per_rung = (corpus - float_floor) / n_rungs if corpus > float_floor else 0.0
    principal_per_rung = max(0.0, principal_per_rung)

    liquid_float = corpus - principal_per_rung * n_rungs
    rung_principal = [principal_per_rung] * n_rungs
    rung_maturity_month = [ladder[i].tenor_months for i in range(n_rungs)]

    total_interest = 0.0
    shortfall_months = []
    cash_calls = dict(params.seasonal_cash_calls)

    for m in range(months):
        collected = monthly_dues_total * float(collection_rate_by_month[m])
        liquid_float += collected
        liquid_float -= monthly_dues_total  # illustrative assumption: routine opex outflow ~= monthly dues raised

        for i in range(n_rungs):
            if rung_maturity_month[i] == m:
                monthly_rate = ladder[i].annual_rate_pct / 100.0 / 12.0
                interest = rung_principal[i] * monthly_rate * ladder[i].tenor_months
                total_interest += interest
                liquid_float += rung_principal[i] + interest
                # re-ladder: place the matured principal back out for the same tenor
                reinvest = max(0.0, liquid_float - float_floor) * (1.0 / n_rungs) if liquid_float > float_floor else 0.0
                # keep the model simple and stable: reinvest the same principal amount if the float can bear it
                reinvest_amount = min(rung_principal[i], max(0.0, liquid_float - float_floor))
                liquid_float -= reinvest_amount
                rung_principal[i] = reinvest_amount
                rung_maturity_month[i] = m + ladder[i].tenor_months

        if m in cash_calls:
            call_amount = cash_calls[m] * monthly_dues_total
            if liquid_float < call_amount:
                shortfall_months.append(m)
            else:
                liquid_float -= call_amount

    return TreasuryRunResult(
        total_interest_earned=total_interest,
        shortfall_months=tuple(shortfall_months),
        shortfall_count=len(shortfall_months),
        ending_liquid_float=liquid_float,
    )
