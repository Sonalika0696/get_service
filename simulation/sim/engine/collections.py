"""Collection-rate simulation and arrears ageing (Phase 13 checklist item 5).

Each flat's resident has a payment-behaviour class (config.py
PAYMENT_BEHAVIOUR_CLASSES). Each month a due is raised; whether and when it
is paid is drawn from that class's parameters. Arrears age in buckets and a
simple monthly late fee accrues on the overdue balance, mirroring the RoU's
description of a collections/arrears module without depending on the
backend's actual implementation (this is a synthetic behavioural model, not
a re-derivation of backend code).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import PaymentBehaviourClass, SimParams


@dataclass(frozen=True)
class FlatCollectionOutcome:
    flat_id: str
    behaviour: str
    months_paid: int
    months_defaulted: int
    total_due: float
    total_paid: float
    total_late_fees: float
    max_arrears_days: int


def _behaviour_lookup(params: SimParams) -> dict[str, PaymentBehaviourClass]:
    return {b.name: b for b in params.payment_behaviour_classes}


def simulate_flat_collections(behaviour_name: str, params: SimParams, rng: np.random.Generator) -> FlatCollectionOutcome:
    behaviour = _behaviour_lookup(params)[behaviour_name]
    months = params.horizon_months
    due = params.monthly_due_per_flat

    total_due = 0.0
    total_paid = 0.0
    total_late_fees = 0.0
    months_paid = 0
    months_defaulted = 0
    max_delay_months = 0.0

    for _m in range(months):
        total_due += due
        if rng.random() < behaviour.default_prob:
            months_defaulted += 1
            continue

        if rng.random() < behaviour.on_time_prob:
            delay_months = 0.0
        else:
            delay_months = float(rng.exponential(behaviour.mean_delay_months))
        max_delay_months = max(max_delay_months, delay_months)

        from sim import config as cfg

        late_fee = due * (cfg.LATE_FEE_PCT_PER_MONTH_OVERDUE / 100.0) * delay_months
        total_paid += due
        total_late_fees += late_fee
        months_paid += 1

    max_arrears_days = int(round(max_delay_months * 30))

    return FlatCollectionOutcome(
        flat_id="",
        behaviour=behaviour_name,
        months_paid=months_paid,
        months_defaulted=months_defaulted,
        total_due=total_due,
        total_paid=total_paid,
        total_late_fees=total_late_fees,
        max_arrears_days=max_arrears_days,
    )


def ageing_bucket(days: int, edges: tuple = (30, 60, 90)) -> str:
    if days <= 0:
        return "current"
    if days <= edges[0]:
        return f"0-{edges[0]}"
    if days <= edges[1]:
        return f"{edges[0]}-{edges[1]}"
    if days <= edges[2]:
        return f"{edges[1]}-{edges[2]}"
    return f"{edges[2]}+"
