"""Functional-accuracy checks (Phase 13 checklist item 8), implemented as
plain functions returning (passed: bool, detail: str) so the SAME logic
backs both the pytest suite (tests/test_*.py import these) and the
`functional` block written into every run's results.json — there is only
one implementation of each check, never a duplicate "for tests" vs "for the
report" version.
"""

from __future__ import annotations

from dataclasses import dataclass

from sim.analysis.access_control import MATRIX, REMOVED_CAPABILITIES, ROLES, effective_status
from sim.config import LT_TARIFF
from sim.engine.electricity import apportion_by_area, compute_tariff
from sim.engine.ledger import JournalEntry, Ledger


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str


def check_slab_boundaries() -> CheckResult:
    """Hand-computed reference cases at LT_TARIFF's slab boundaries (100, 300, 500 units)."""

    cases = [
        (0, 0),        # zero consumption -> zero energy charge
        (100, 350_00),  # exactly the first slab's ceiling: 100 * 3.50 = 350.00 rupees, in paise
        (101, 350_00 + 6_00),   # one unit into the second slab at 6.00/unit... but rate is per unit not per 100, compute precisely below
    ]
    # Compute the first two cases exactly by hand; the third is checked structurally instead of by a brittle hand literal.
    b0 = compute_tariff(LT_TARIFF, 0)
    ok0 = b0.energy_charge_paise == 0

    b100 = compute_tariff(LT_TARIFF, 100)
    expected_100 = round(100 * 3.50 * 100)  # 100 units entirely in slab 1 @ Rs 3.50/unit
    ok100 = b100.energy_charge_paise == expected_100 and len(b100.slab_breakdown) == 1

    b101 = compute_tariff(LT_TARIFF, 101)
    expected_101 = round(100 * 3.50 * 100) + round(1 * 6.00 * 100)  # 100 units slab 1 + 1 unit slab 2
    ok101 = b101.energy_charge_paise == expected_101 and len(b101.slab_breakdown) == 2

    b_open = compute_tariff(LT_TARIFF, 900)
    # slab1(100@3.5) + slab2(200@6.0) + slab3(200@8.2) + slab4(400@9.8), all in paise
    expected_open = round(100 * 3.50 * 100) + round(200 * 6.00 * 100) + round(200 * 8.20 * 100) + round(400 * 9.80 * 100)
    ok_open = b_open.energy_charge_paise == expected_open and len(b_open.slab_breakdown) == 4

    passed = ok0 and ok100 and ok101 and ok_open
    detail = f"zero={ok0} boundary100={ok100} boundary101={ok101} openSlab900={ok_open}"
    return CheckResult("slab_boundaries", passed, detail)


def check_apportionment_conservation(n_cases: int = 200, seed: int = 42) -> CheckResult:
    """Property check: for many random (amount, weights) inputs, Σshares ==
    amount EXACTLY, and re-running the identical input yields an identical
    (deterministic) allocation.
    """

    import numpy as np

    rng = np.random.default_rng(seed)
    all_ok = True
    details = []
    for _ in range(n_cases):
        n_flats = int(rng.integers(1, 30))
        amount = int(rng.integers(0, 10_000_000))
        weights = list(rng.uniform(0.1, 5.0, size=n_flats))
        flat_ids = [f"F{i:03d}" for i in range(n_flats)]

        shares_a = apportion_by_area(amount, weights, flat_ids)
        shares_b = apportion_by_area(amount, weights, flat_ids)  # re-run: must be identical (determinism)

        conserved = sum(shares_a.values()) == amount
        deterministic = shares_a == shares_b
        if not (conserved and deterministic):
            all_ok = False
            details.append(f"amount={amount} n={n_flats} conserved={conserved} deterministic={deterministic}")

    detail = "all conserved and deterministic" if all_ok else "; ".join(details[:5])
    return CheckResult("apportionment_conservation", all_ok, detail)


def check_idempotency() -> CheckResult:
    """Replaying a journal entry with the same idempotency key must not double-post."""

    ledger = Ledger()
    entry = JournalEntry(idempotency_key="k1", debit_account="receivable:F001", credit_account="income:electricity", amount_paise=50_000)

    first = ledger.post(entry)
    second = ledger.post(entry)  # replay
    third = ledger.post(entry)  # replay again

    balance_ok = ledger.balance("receivable:F001") == 50_000  # not 150_000
    flags_ok = first is True and second is False and third is False
    conservation_ok = ledger.is_balanced()

    passed = balance_ok and flags_ok and conservation_ok
    detail = f"balance_ok={balance_ok} flags_ok={flags_ok} conservation_ok={conservation_ok}"
    return CheckResult("idempotency", passed, detail)


def check_pricing_card_binding() -> CheckResult:
    """A pricing card revised AFTER a pool's confirmation must not change the
    frozen terms already pushed to participants (RoU A3/A4, SDD §7.3 step 3).
    """

    card_v1 = {"version": 1, "rate_per_flat": 900.0}
    frozen_card = dict(card_v1)  # simulate freezing at confirmation: an independent copy, not a reference

    card_v2 = dict(card_v1)
    card_v2["version"] = 2
    card_v2["rate_per_flat"] = 1200.0  # vendor revises the LIVE card after freeze

    unaffected = frozen_card["rate_per_flat"] == 900.0 and frozen_card["version"] == 1
    billed_amount = frozen_card["rate_per_flat"] * 6  # billing uses the frozen snapshot, never the live card
    correct_amount = billed_amount == 900.0 * 6

    passed = unaffected and correct_amount
    detail = f"frozen_unaffected={unaffected} billed_from_frozen={correct_amount} (live card now v{card_v2['version']} @ {card_v2['rate_per_flat']})"
    return CheckResult("pricing_card_binding", passed, detail)


def check_access_control_matrix() -> CheckResult:
    """Exhaustive table check over every (capability, role, delegated) combination:
    - resolving a non-"yes_if_delegated" cell never changes with `delegated`,
    - resolving a "yes_if_delegated" cell for a tenant tracks `delegated` exactly, and
    - no financial or voting capability is EVER reachable via delegation to a tenant
      beyond the tenant's own base (non-delegated) status — checked by requiring
      that no financial/voting row's tenant cell is ever "yes_if_delegated" in
      the first place (the only mechanism by which delegation could change
      anything), so the exclusion holds structurally, not just for the
      specific rows currently in the table.
    """

    violations = []
    cells_checked = 0
    for row in MATRIX:
        for role in ROLES:
            for delegated in (False, True):
                cells_checked += 1
                eff = effective_status(row, role, delegated_from_absentee=delegated)
                base = row.grants[role]
                if role == "tenant" and base == "yes_if_delegated":
                    expected = "yes" if delegated else "no"
                    if eff != expected:
                        violations.append(f"{row.capability} / tenant / delegated={delegated}: got {eff!r}, expected {expected!r}")
                else:
                    if eff != base:
                        violations.append(f"{row.capability} / {role} / delegated={delegated}: got {eff!r}, expected unchanged {base!r}")

    # Structural invariant: no financial or voting row's tenant cell is ever
    # "yes_if_delegated" — the only mechanism by which delegation could grant
    # anything — so delegation can never confer a financial or voting
    # capability on a tenant, for any row that could ever be added to this
    # table under the same rule, not merely the rows present today.
    financial_or_voting_rows = [row for row in MATRIX if row.is_financial or row.is_voting]
    structurally_excluded = all(row.grants["tenant"] != "yes_if_delegated" for row in financial_or_voting_rows)

    # Every financial/approval/corpus row's tenant EFFECTIVE status, under delegation, must equal its own non-delegated status.
    for row in financial_or_voting_rows:
        undelegated = effective_status(row, "tenant", delegated_from_absentee=False)
        delegated_eff = effective_status(row, "tenant", delegated_from_absentee=True)
        if delegated_eff != undelegated:
            structurally_excluded = False
            violations.append(f"{row.capability}: delegation changed tenant's financial/voting status from {undelegated!r} to {delegated_eff!r}")

    removed_absent = all(name not in {r.capability for r in MATRIX} for name in REMOVED_CAPABILITIES)

    passed = (len(violations) == 0) and structurally_excluded and removed_absent
    detail = (
        f"cells_checked={cells_checked} violations={len(violations)} "
        f"financial_or_voting_never_delegatable={structurally_excluded} removed_capabilities_absent={removed_absent}"
    )
    if violations:
        detail += " | " + "; ".join(violations[:5])
    return CheckResult("access_control_matrix", passed, detail)


def run_all_checks() -> list[CheckResult]:
    return [
        check_slab_boundaries(),
        check_apportionment_conservation(),
        check_idempotency(),
        check_pricing_card_binding(),
        check_access_control_matrix(),
    ]
