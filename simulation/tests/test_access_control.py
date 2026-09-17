"""Dedicated tests for the authoritative access-control matrix (orchestrator
review, post-5e67f4b): the RoU §6 table as amended, transcribed verbatim in
sim/analysis/access_control.py. Complements the exhaustive check already run
via sim.analysis.functional.check_access_control_matrix.
"""

from sim.analysis.access_control import (
    MATRIX,
    REMOVED_CAPABILITIES,
    ROLES,
    effective_status,
)
from sim.analysis.functional import check_access_control_matrix

CAPABILITY_NAMES = {row.capability for row in MATRIX}


def test_matrix_has_exactly_the_authoritative_rows():
    expected = {
        "View own flat's bills",
        "Pay own flat's dues",
        "Join a bulk-buy pool",
        "Raise a service request",
        "Join an open service request",
        "Register for events and camps",
        "Donate to welfare fund",
        "Create an event",
        "Approve expenditure, rung 2",
        "Approve expenditure, rung 3",
        "Move corpus funds",
        "View society-wide arrears",
        "Assign a vendor to a pool",
        "Publish a pricing card",
        "Confirm a booking",
        "Submit a charge breakup",
        "View resident contact details",
    }
    assert CAPABILITY_NAMES == expected


def test_removed_capabilities_are_absent():
    for name in REMOVED_CAPABILITIES:
        assert name not in CAPABILITY_NAMES, f"{name!r} should have been removed from the matrix"
    assert len(REMOVED_CAPABILITIES) == 3


def test_a_sample_of_cells_match_the_orchestrator_supplied_table():
    by_name = {row.capability: row for row in MATRIX}

    assert by_name["View own flat's bills"].grants == {
        "owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes_if_delegated", "committee": "yes", "vendor": "no",
    }
    assert by_name["Approve expenditure, rung 2"].grants["committee"] == "yes_two_distinct_officers"
    assert by_name["Approve expenditure, rung 3"].grants["committee"] == "yes_committee_majority"
    assert by_name["Move corpus funds"].grants["committee"] == "yes_dual"
    assert by_name["View resident contact details"].grants["vendor"] == "only_on_consent_per_transaction"
    assert by_name["Publish a pricing card"].grants == {
        "owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "no", "vendor": "yes",
    }


def test_delegation_resolves_yes_if_delegated_for_tenant_only():
    by_name = {row.capability: row for row in MATRIX}
    row = by_name["Raise a service request"]

    assert effective_status(row, "tenant", delegated_from_absentee=False) == "no"
    assert effective_status(row, "tenant", delegated_from_absentee=True) == "yes"
    # Delegation is meaningless for every other role: their cell is untouched.
    for role in ROLES:
        if role == "tenant":
            continue
        assert effective_status(row, role, delegated_from_absentee=True) == effective_status(row, role, delegated_from_absentee=False)


def test_no_financial_or_voting_row_is_ever_delegable_to_a_tenant():
    for row in MATRIX:
        if row.is_financial or row.is_voting:
            assert row.grants["tenant"] != "yes_if_delegated", f"{row.capability} must never be delegable"
            # And delegation cannot change the tenant's effective status either way.
            assert effective_status(row, "tenant", True) == effective_status(row, "tenant", False)


def test_exhaustive_matrix_check_passes():
    result = check_access_control_matrix()
    assert result.passed, result.detail
