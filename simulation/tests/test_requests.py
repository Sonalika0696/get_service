"""Tests for pooled-request formation (orchestrator review item 4): confirms
the participation/threshold sensitivity dimension actually exercises the
LAPSED-pool path (proceeded < 1, zero saving), not just the always-clears
regime the original threshold grid happened to land in.
"""

import numpy as np

from sim.config import ServiceCategory
from sim.engine.requests import form_pool


def test_pool_lapses_when_participants_fall_short_of_threshold():
    category = ServiceCategory(name="test_cat", threshold=80, card_rate_per_flat=1000.0, discount_ladder=((80, 0.10),))
    rng = np.random.default_rng(0)

    lapsed_seen = False
    for _ in range(50):
        outcome = form_pool(category, n_flats=90, participation_rate=0.3, rng=rng)  # mean ~27 participants, well below threshold 80
        if not outcome.proceeded:
            lapsed_seen = True
            assert outcome.aggregate_saving_vs_card == 0.0
            assert outcome.discount_applied == 0.0
            assert outcome.price_per_flat == category.card_rate_per_flat

    assert lapsed_seen, "expected at least one lapsed pool at low participation vs a high threshold"


def test_pool_proceeds_when_participation_comfortably_exceeds_threshold():
    category = ServiceCategory(name="test_cat", threshold=5, card_rate_per_flat=1000.0, discount_ladder=((5, 0.10),))
    rng = np.random.default_rng(0)

    for _ in range(50):
        outcome = form_pool(category, n_flats=90, participation_rate=0.9, rng=rng)  # mean ~81 participants, well above threshold 5
        assert outcome.proceeded
        assert outcome.aggregate_saving_vs_card > 0.0


def test_high_threshold_sensitivity_grid_actually_produces_lapses():
    """Mirrors sim.scenarios.scenario_pooling_aggregation's bulk_grocery
    threshold grid: at the default 90-flat society and 0.55 participation
    rate (mean ~49.5 participants), a threshold of 80 should lapse far more
    often than a threshold of 5.
    """

    from sim.config import DEFAULT_PARAMS

    bulk_grocery = next(c for c in DEFAULT_PARAMS.service_categories if c.name == "bulk_grocery")

    def proceed_rate(threshold: int, n: int = 300) -> float:
        category = ServiceCategory(name=bulk_grocery.name, threshold=threshold, card_rate_per_flat=bulk_grocery.card_rate_per_flat, discount_ladder=bulk_grocery.discount_ladder)
        rng = np.random.default_rng(123)
        outcomes = [form_pool(category, DEFAULT_PARAMS.n_flats, DEFAULT_PARAMS.participation_rate, rng) for _ in range(n)]
        return sum(1 for o in outcomes if o.proceeded) / n

    low_threshold_rate = proceed_rate(5)
    high_threshold_rate = proceed_rate(80)

    assert low_threshold_rate > 0.99
    assert high_threshold_rate < 0.10
    assert high_threshold_rate < low_threshold_rate
