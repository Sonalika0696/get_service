"""Generates the synthetic 90-flat reference society: flat IDs and area weights."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import SimParams


@dataclass(frozen=True)
class Flat:
    flat_id: str
    area_sqft: float
    area_weight: float  # this flat's area / total area, sums to 1.0 across the society


def generate_society(params: SimParams, rng: np.random.Generator) -> list[Flat]:
    """Truncated-normal area distribution (see config.py FLAT_AREA_* for the
    illustrative assumption). Deterministic given `rng`'s state.
    """

    from sim import config as cfg

    n = params.n_flats
    areas = rng.normal(cfg.FLAT_AREA_MEAN_SQFT, cfg.FLAT_AREA_STD_SQFT, size=n)
    areas = np.clip(areas, cfg.FLAT_AREA_MIN_SQFT, cfg.FLAT_AREA_MAX_SQFT)
    total = areas.sum()

    flats = []
    for i in range(n):
        flat_id = f"F{i + 1:03d}"
        flats.append(Flat(flat_id=flat_id, area_sqft=float(areas[i]), area_weight=float(areas[i] / total)))
    return flats
