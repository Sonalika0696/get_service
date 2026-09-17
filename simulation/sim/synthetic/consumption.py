"""Per-flat monthly electricity consumption profiles with a seasonal multiplier.

See sim/config.py FLAT_CONSUMPTION_MEAN_KWH / SEASONAL_MULTIPLIER for the
illustrative assumptions.
"""

from __future__ import annotations

import numpy as np

from sim.config import SimParams
from sim.synthetic.society import Flat


def generate_consumption(flats: list[Flat], params: SimParams, rng: np.random.Generator) -> np.ndarray:
    """Returns an (n_flats, horizon_months) array of kWh consumed by each flat
    in each month. Log-normal per-flat base draw x seasonal multiplier.
    """

    from sim import config as cfg

    n = len(flats)
    months = params.horizon_months
    mu = np.log(params.flat_consumption_mean_kwh) - 0.5 * params.flat_consumption_sigma**2
    base = rng.lognormal(mean=mu, sigma=params.flat_consumption_sigma, size=n)

    seasonal = np.array(cfg.SEASONAL_MULTIPLIER[:months] if months <= 12 else (cfg.SEASONAL_MULTIPLIER * (months // 12 + 1))[:months])
    consumption = np.outer(base, seasonal)
    return consumption


def common_area_consumption(flat_consumption: np.ndarray, common_area_load_fraction: float) -> np.ndarray:
    """Common-area load modelled as a fraction of the SUM of individual flat
    consumption for that month (illustrative assumption — real common-area
    load is bulk-minus-submeters; here bulk is defined as
    flats_total / (1 - fraction) so that fraction is common/bulk exactly).
    Returns a 1-D array of length horizon_months.
    """

    flats_total_by_month = flat_consumption.sum(axis=0)
    # bulk = flats_total + common; common = fraction * bulk  =>  common = fraction/(1-fraction) * flats_total
    return flats_total_by_month * (common_area_load_fraction / (1.0 - common_area_load_fraction))
