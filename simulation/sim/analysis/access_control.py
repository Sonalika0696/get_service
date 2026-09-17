"""Access-control capability matrix, encoded as data, for the Phase 13
functional-accuracy checklist item "access-control matrix asserted
exhaustively" (RoU §6 roles table, as amended by DOC_AMENDMENTS_V2.md A8;
SOFTWARE_DESIGN.md §7.1: "Delegation from an absentee owner is scoped to
named operational capabilities; financial authorisation is excluded at the
type level, so an over-broad delegation cannot be expressed"; §8.3 threat
model: "Tenant acquiring owner rights through delegation" is mitigated by
"Financial and voting capabilities excluded from the delegable set at the
type level").

The five roles are owner-occupier, owner-absentee, tenant, committee,
vendor, matching the RoU §6 matrix's column order. Some capability rows
below (raise/join a service request, create an event, approve expenditure
rung 2/3, assign a vendor to a pool) are transcribed directly from
DOC_AMENDMENTS_V2.md A8's "affected rows only" excerpt, which is the only
part of the full RoU §6 matrix present in this worktree's docs. The
remaining rows are this simulation's own reasonable completion of a
role x capability matrix consistent with the RoU/SDD narrative sections
(financial-move capabilities restricted to committee/vendor per SDD §8.1;
voting withdrawn from the product per DOC_AMENDMENTS_V2.md A1, but retained
here as an explicitly-excluded-from-delegation capability because the
type-level exclusion in SDD §7.1/§8.3 names it alongside financial
authorisation) — flagged inline as an ASSUMPTION since the source document
does not enumerate the full table.
"""

from __future__ import annotations

from dataclasses import dataclass

ROLES = ("owner_occupier", "owner_absentee", "tenant", "committee", "vendor")


@dataclass(frozen=True)
class CapabilityRow:
    capability: str
    grants: dict  # role -> bool, the role's OWN (non-delegated) right
    delegatable: bool  # can an absentee owner delegate this to an operating tenant/agent?
    is_financial: bool
    is_voting: bool
    source: str  # "RoU §6 (A8)" for transcribed rows, "assumption" for this sim's completion


MATRIX: tuple[CapabilityRow, ...] = (
    # --- Transcribed verbatim from DOC_AMENDMENTS_V2.md A8 ("REPLACE §6, roles matrix — affected rows only") ---
    CapabilityRow(
        capability="Raise a service request",
        grants={"owner_occupier": True, "owner_absentee": True, "tenant": False, "committee": True, "vendor": False},
        delegatable=True,  # RoU row: "Yes, if delegated" for tenant
        is_financial=False,
        is_voting=False,
        source="RoU §6 (A8)",
    ),
    CapabilityRow(
        capability="Join an open service request",
        grants={"owner_occupier": True, "owner_absentee": True, "tenant": True, "committee": True, "vendor": False},
        delegatable=False,
        is_financial=False,
        is_voting=False,
        source="RoU §6 (A8)",
    ),
    CapabilityRow(
        capability="Create an event",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": True, "vendor": False},
        delegatable=False,
        is_financial=False,
        is_voting=False,
        source="RoU §6 (A8)",
    ),
    CapabilityRow(
        capability="Approve expenditure, rung 2",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": True, "vendor": False},
        delegatable=False,  # financial authorisation excluded from the delegable set at the type level (SDD §7.1)
        is_financial=True,
        is_voting=False,
        source="RoU §6 (A8)",
    ),
    CapabilityRow(
        capability="Approve expenditure, rung 3",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": True, "vendor": False},
        delegatable=False,
        is_financial=True,
        is_voting=False,
        source="RoU §6 (A8)",
    ),
    CapabilityRow(
        capability="Assign a vendor to a pool",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": True, "vendor": False},
        delegatable=False,
        is_financial=False,
        is_voting=False,
        source="RoU §6 (A8)",
    ),
    # --- ASSUMPTION: this simulation's own completion of the matrix, consistent with the narrative sections but not transcribed from an enumerated RoU §6 table ---
    CapabilityRow(
        capability="View own flat's bills and payment history",
        grants={"owner_occupier": True, "owner_absentee": True, "tenant": True, "committee": True, "vendor": False},
        delegatable=False,
        is_financial=False,
        is_voting=False,
        source="assumption",
    ),
    CapabilityRow(
        capability="Make a payment toward own flat's dues",
        grants={"owner_occupier": True, "owner_absentee": True, "tenant": True, "committee": False, "vendor": False},
        delegatable=False,  # financial: paying one's own dues is not delegable to a non-occupant
        is_financial=True,
        is_voting=False,
        source="assumption",
    ),
    CapabilityRow(
        capability="Initiate a payout / corpus movement (rung 1)",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": True, "vendor": False},
        delegatable=False,
        is_financial=True,
        is_voting=False,
        source="assumption",
    ),
    CapabilityRow(
        capability="Publish or revise a pricing card",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": False, "vendor": True},
        delegatable=False,
        is_financial=False,
        is_voting=False,
        source="assumption",
    ),
    CapabilityRow(
        capability="Submit a charge sheet against a frozen card",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": False, "vendor": True},
        delegatable=False,
        is_financial=False,
        is_voting=False,
        source="assumption",
    ),
    CapabilityRow(
        capability="Grant or revoke a delegation",
        grants={"owner_occupier": False, "owner_absentee": True, "tenant": False, "committee": False, "vendor": False},
        delegatable=False,  # delegation of the power to delegate is not itself delegable
        is_financial=False,
        is_voting=False,
        source="assumption",
    ),
    CapabilityRow(
        # Community voting is WITHDRAWN from the product (DOC_AMENDMENTS_V2.md A1);
        # retained here purely as a capability row so the type-level exclusion of
        # voting from the delegable set (SDD §7.1, §8.3) has something concrete to
        # assert against. Grants are all False because the feature does not exist.
        capability="Cast a vote in a general-body decision (WITHDRAWN from product; see DOC_AMENDMENTS_V2.md A1)",
        grants={"owner_occupier": False, "owner_absentee": False, "tenant": False, "committee": False, "vendor": False},
        delegatable=False,
        is_financial=False,
        is_voting=True,
        source="assumption",
    ),
)


def effective_capability(row: CapabilityRow, role: str, delegated_from_absentee: bool = False) -> bool:
    """The capability a `role` actually has, given whether they are acting
    under an absentee owner's delegation (only meaningful for role=="tenant").

    Delegation can only ever ADD a capability that is (a) marked
    `delegatable` on this row and (b) granted to `owner_absentee` in the
    first place; it can never grant a financial or voting capability,
    because no row with `is_financial` or `is_voting` is ever `delegatable`
    (asserted exhaustively in tests/test_access_control.py) — the exclusion
    holds by construction of this table, mirroring the backend's "excluded
    at the type level" design (SDD §7.1).
    """

    base = row.grants[role]
    if role == "tenant" and delegated_from_absentee and row.delegatable:
        return bool(row.grants["owner_absentee"])
    return bool(base)
