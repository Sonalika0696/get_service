"""Per-flat monthly water demand and the society's seasonal municipal/tanker/
borewell source mix, including a stochastic municipal-interruption event.

See sim/config.py FLAT_WATER_*, *_SHARE_BY_MONTH, *_COST_PER_KL,
MUNICIPAL_INTERRUPTION_PROB for the illustrative assumptions.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import SimParams
from sim.synthetic.society import Flat


@dataclass(frozen=True)
class MonthlyWaterSources:
    month: int
    municipal_kl: float
    tanker_kl: float
    borewell_kl: float
    municipal_interrupted: bool


def generate_water_demand(flats: list[Flat], params: SimParams, rng: np.random.Generator) -> np.ndarray:
    """Returns an (n_flats, horizon_months) array of kilolitres consumed."""

    n = len(flats)
    months = params.horizon_months
    mu = np.log(params.flat_water_mean_kl) - 0.5 * params.flat_water_sigma**2
    base = rng.lognormal(mean=mu, sigma=params.flat_water_sigma, size=n)
    # Water demand is far less seasonal than electricity in this reference regime; flat profile.
    return np.tile(base.reshape(-1, 1), (1, months))


def generate_source_mix(total_demand_by_month: np.ndarray, params: SimParams, rng: np.random.Generator) -> list[MonthlyWaterSources]:
    from sim import config as cfg

    months = len(total_demand_by_month)
    out = []
    for m in range(months):
        interrupted = bool(rng.random() < params.municipal_interruption_prob)
        total = float(total_demand_by_month[m])
        if interrupted:
            municipal_share = 0.0
            borewell_share = min(1.0, cfg.BOREWELL_SHARE_BY_MONTH[m % 12] * 1.3)  # illustrative: borewell draws harder when municipal is out
        else:
            municipal_share = cfg.MUNICIPAL_SHARE_BY_MONTH[m % 12]
            borewell_share = cfg.BOREWELL_SHARE_BY_MONTH[m % 12]
        tanker_share = max(0.0, 1.0 - municipal_share - borewell_share)

        out.append(
            MonthlyWaterSources(
                month=m,
                municipal_kl=total * municipal_share,
                tanker_kl=total * tanker_share,
                borewell_kl=total * borewell_share,
                municipal_interrupted=interrupted,
            )
        )
    return out
