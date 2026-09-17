"""Additional engine-level tests beyond the functional-accuracy block:
tariff edge cases and the HT-vs-LT comparison's basic sanity properties.
"""

from sim.config import LT_TARIFF, HT_TARIFF
from sim.engine.electricity import apportion_by_area, compare_ht_vs_lt, compute_tariff


def test_zero_consumption_still_bills_fixed_and_cess():
    breakdown = compute_tariff(LT_TARIFF, 0)
    assert breakdown.energy_charge_paise == 0
    assert breakdown.fixed_charge_paise > 0
    assert breakdown.duty_cess_paise > 0  # fixed_cess component applies even at 0 consumption
    assert breakdown.total_paise == breakdown.fixed_charge_paise + breakdown.duty_cess_paise


def test_negative_consumption_is_clamped_to_zero():
    breakdown = compute_tariff(LT_TARIFF, -50)
    assert breakdown.energy_charge_paise == 0
    assert breakdown.slab_breakdown == ()


def test_open_ended_final_slab_has_no_ceiling():
    b1 = compute_tariff(LT_TARIFF, 10_000)
    b2 = compute_tariff(LT_TARIFF, 20_000)
    assert b2.energy_charge_paise > b1.energy_charge_paise


def test_apportion_by_area_single_flat_gets_everything():
    shares = apportion_by_area(12345, [1.0], ["F001"])
    assert shares == {"F001": 12345}


def test_apportion_by_area_empty_flats_returns_empty():
    assert apportion_by_area(1000, [], []) == {}


def test_apportion_by_area_zero_amount_all_zero():
    shares = apportion_by_area(0, [1.0, 2.0, 3.0], ["A", "B", "C"])
    assert sum(shares.values()) == 0
    assert all(v == 0 for v in shares.values())


def test_ht_vs_lt_saving_is_a_real_number_and_ht_is_materially_cheaper_at_scale():
    # Illustrative reference regime: a moderately loaded 90-flat society should show a positive HT saving,
    # since HT_TARIFF's flat energy rate + duty is set below LT_TARIFF's upper slabs in config.py.
    flat_kwh = [2400.0] * 90  # ~200 kWh/month average annualised
    common_kwh = 90 * 2400.0 * 0.14 / 0.86
    result = compare_ht_vs_lt(flat_kwh, common_kwh, LT_TARIFF, HT_TARIFF, regulatory_margin_cap_fraction=0.02)
    assert result.saving_paise > 0
    assert 0 < result.saving_pct < 100
