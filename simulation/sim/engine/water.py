"""Blended per-kilolitre water rate across municipal/tanker/borewell sources.

Mirrors backend/src/modules/water/blend/water-blend.util.ts: blended rate =
total cost / total kilolitres, rounded to the nearest whole paise
(round-half-up); guards the zero-kilolitres case; reports each source's
share of TOTAL COST (not volume).
"""

from __future__ import annotations

from dataclasses import dataclass

from sim import config as cfg
from sim.synthetic.water import MonthlyWaterSources


@dataclass(frozen=True)
class SourceDerivation:
    kind: str
    kilolitres: float
    cost_paise: int
    share_pct: float


@dataclass(frozen=True)
class BlendedRate:
    total_kilolitres: float
    total_cost_paise: int
    rate_paise_per_kl: int
    derivation: tuple


def blended_rate_per_kl(month: MonthlyWaterSources) -> BlendedRate:
    sources = [
        ("municipal", month.municipal_kl, cfg.MUNICIPAL_COST_PER_KL),
        ("tanker", month.tanker_kl, cfg.TANKER_COST_PER_KL),
        ("borewell", month.borewell_kl, cfg.BOREWELL_COST_PER_KL),
    ]
    total_kl = sum(kl for _, kl, _ in sources)
    costs_paise = [(kind, kl, int(round(kl * rate_per_kl * 100))) for kind, kl, rate_per_kl in sources]
    total_cost_paise = sum(c for _, _, c in costs_paise)

    if total_kl == 0:
        return BlendedRate(total_kilolitres=0.0, total_cost_paise=total_cost_paise, rate_paise_per_kl=0, derivation=())

    rate_paise_per_kl = int(round(total_cost_paise / total_kl))
    derivation = tuple(
        SourceDerivation(
            kind=kind,
            kilolitres=kl,
            cost_paise=cost,
            share_pct=(cost / total_cost_paise * 100.0) if total_cost_paise > 0 else 0.0,
        )
        for kind, kl, cost in costs_paise
    )

    return BlendedRate(total_kilolitres=total_kl, total_cost_paise=total_cost_paise, rate_paise_per_kl=rate_paise_per_kl, derivation=derivation)
