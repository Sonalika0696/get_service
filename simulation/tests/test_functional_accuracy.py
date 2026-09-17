"""Phase 13 functional-accuracy block, run as pytest. Each test delegates to
the SAME check function used to populate every run's results.json "functional"
key (sim.analysis.functional) — there is exactly one implementation per check.
"""

from sim.analysis.functional import (
    check_access_control_matrix,
    check_apportionment_conservation,
    check_idempotency,
    check_pricing_card_binding,
    check_slab_boundaries,
)


def test_slab_boundaries():
    result = check_slab_boundaries()
    assert result.passed, result.detail


def test_apportionment_conservation():
    result = check_apportionment_conservation()
    assert result.passed, result.detail


def test_idempotency():
    result = check_idempotency()
    assert result.passed, result.detail


def test_pricing_card_binding():
    result = check_pricing_card_binding()
    assert result.passed, result.detail


def test_access_control_matrix_exhaustive():
    result = check_access_control_matrix()
    assert result.passed, result.detail
