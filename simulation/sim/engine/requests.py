"""Pooled service-request formation and the aggregation-saving computation
(Phase 13 checklist item 4 / RoU A4/A9/M7): a participation threshold per
category gates whether a pool proceeds; a volume-discount ladder on the
vendor's published card is the only saving mechanism, since vendors do not
bid (DECISIONS_V2_SCOPE.md 4.3) — this isolates the pure volume effect.
"""

from __future__ import annotations

from dataclasses import dataclass

from sim.config import ServiceCategory


def discount_for_participants(category: ServiceCategory, participants: int) -> float:
    """Highest ladder rung whose min_participants <= participants; 0 if below every rung."""

    applicable = [d for (min_p, d) in category.discount_ladder if min_p <= participants]
    return max(applicable) if applicable else 0.0


@dataclass(frozen=True)
class PoolOutcome:
    category: str
    participants: int
    proceeded: bool
    card_rate_per_flat: float
    discount_applied: float
    price_per_flat: float
    aggregate_saving_vs_card: float  # (card_rate - price_per_flat) * participants; 0 if pool lapsed


def form_pool(category: ServiceCategory, n_flats: int, participation_rate: float, rng) -> PoolOutcome:
    """Binomial draw of how many of n_flats join this category's pool this
    cycle, then applies the threshold gate and discount ladder. `rng` is a
    numpy Generator.
    """

    participants = int(rng.binomial(n_flats, participation_rate))
    proceeded = participants >= category.threshold
    if not proceeded:
        return PoolOutcome(
            category=category.name,
            participants=participants,
            proceeded=False,
            card_rate_per_flat=category.card_rate_per_flat,
            discount_applied=0.0,
            price_per_flat=category.card_rate_per_flat,
            aggregate_saving_vs_card=0.0,
        )

    discount = discount_for_participants(category, participants)
    price_per_flat = category.card_rate_per_flat * (1 - discount)
    saving = (category.card_rate_per_flat - price_per_flat) * participants

    return PoolOutcome(
        category=category.name,
        participants=participants,
        proceeded=True,
        card_rate_per_flat=category.card_rate_per_flat,
        discount_applied=discount,
        price_per_flat=price_per_flat,
        aggregate_saving_vs_card=saving,
    )
