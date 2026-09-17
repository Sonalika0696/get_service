"""Access-control capability matrix, encoded as data, for the Phase 13
functional-accuracy checklist item "access-control matrix asserted
exhaustively".

Orchestrator review (post-5e67f4b): the original matrix in this file marked
most rows `source="assumption"` because the worktree lacked an enumerated
RoU §6 table. The orchestrator supplied the authoritative table below —
RoU §6 "Roles and Access Matrix" AS AMENDED by DOC_AMENDMENTS_V2.md A8
(roles-matrix replacement rows, and invariant I8: no voting) and
DECISIONS_V2_SCOPE.md decision 4.1 (individual service bookings withdrawn;
every engagement is pooled) — and every row below is transcribed from it
verbatim, with `source` set accordingly. Nothing here is this simulation's
own invention any more.

Columns (role order matches the RoU §6 table): owner_occupier,
owner_absentee, tenant, committee, vendor.

Cell values are one of:
  "yes"                          — unconditional grant
  "no"                           — no grant
  "yes_if_delegated"             — the ONLY delegable form: an absentee
                                    owner's OWN "yes" right, extendable to a
                                    tenant only if the owner has delegated it
  "yes_two_distinct_officers"    — committee grant requiring two distinct
                                    officer identities (approval rung 2)
  "yes_committee_majority"       — committee grant requiring a configurable
                                    majority of the committee roster (rung 3)
  "yes_dual"                     — committee grant requiring dual
                                    authorisation (corpus movement)
  "only_on_consent_per_transaction" — vendor grant scoped per transaction and
                                    expiring with the engagement (resident
                                    contact details)

Removed from the product, and asserted ABSENT from this table by
`test_removed_capabilities_are_absent` in tests/test_access_control.py:
  - "Vote in advisory polls" and "Vote in binding polls" — withdrawn per
    DOC_AMENDMENTS_V2.md A8 (roles-matrix row deletion) and invariant I8
    (no resident voting of any kind).
  - "Book a service visit" — withdrawn per DECISIONS_V2_SCOPE.md 4.1 (no
    individual bookings; every engagement is pooled), replaced by the two
    service-request rows ("Raise a service request" / "Join an open
    service request").

Delegation rule (RoU §2.1 / SOFTWARE_DESIGN.md §7.1, §8.3): an absentee
owner may delegate OPERATIONAL capabilities to a tenant — exactly the rows
marked "yes_if_delegated" below (view bills, raise a service request).
Financial authorisation, approval-ladder rungs, corpus movement, and voting
are NEVER delegable and are NEVER expressed as "yes_if_delegated" anywhere
in this table; the owner retains all financial and voting rights
regardless of any delegation. This is asserted exhaustively in
tests/test_access_control.py: no financial/approval/corpus row's tenant
cell is ever "yes_if_delegated", and delegation can never change a
financial/approval/corpus row's effective grant for a tenant.
"""

from __future__ import annotations

from dataclasses import dataclass

ROLES = ("owner_occupier", "owner_absentee", "tenant", "committee", "vendor")

SOURCE = "RoU §6 as amended (DOC_AMENDMENTS_V2 A8; DECISIONS_V2_SCOPE 4.1)"

# Capabilities explicitly withdrawn from the product; MUST NOT appear as a
# capability name in MATRIX (asserted in tests/test_access_control.py).
REMOVED_CAPABILITIES = (
    "Vote in advisory polls",
    "Vote in binding polls",
    "Book a service visit",
)


@dataclass(frozen=True)
class CapabilityRow:
    capability: str
    grants: dict  # role -> one of the cell-value strings documented in the module docstring
    is_financial: bool
    is_voting: bool
    source: str


MATRIX: tuple[CapabilityRow, ...] = (
    CapabilityRow(
        capability="View own flat's bills",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes_if_delegated", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Pay own flat's dues",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes", "committee": "yes", "vendor": "no"},
        is_financial=True,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Join a bulk-buy pool",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Raise a service request",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes_if_delegated", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Join an open service request",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Register for events and camps",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Donate to welfare fund",
        grants={"owner_occupier": "yes", "owner_absentee": "yes", "tenant": "yes", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Create an event",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Approve expenditure, rung 2",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes_two_distinct_officers", "vendor": "no"},
        is_financial=True,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Approve expenditure, rung 3",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes_committee_majority", "vendor": "no"},
        is_financial=True,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Move corpus funds",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes_dual", "vendor": "no"},
        is_financial=True,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="View society-wide arrears",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Assign a vendor to a pool",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes", "vendor": "no"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Publish a pricing card",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "no", "vendor": "yes"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Confirm a booking",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "no", "vendor": "yes"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="Submit a charge breakup",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "no", "vendor": "yes"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
    CapabilityRow(
        capability="View resident contact details",
        grants={"owner_occupier": "no", "owner_absentee": "no", "tenant": "no", "committee": "yes", "vendor": "only_on_consent_per_transaction"},
        is_financial=False,
        is_voting=False,
        source=SOURCE,
    ),
)

_GRANTED_STATUSES = frozenset(
    {
        "yes",
        "yes_two_distinct_officers",
        "yes_committee_majority",
        "yes_dual",
        "only_on_consent_per_transaction",
    }
)


def has_access(status: str) -> bool:
    """True for any status that grants SOME form of access (unconditional,
    multi-approver, or consent-scoped); False for "no" and for
    "yes_if_delegated" when delegation hasn't happened (that resolution is
    `effective_status`'s job, not this helper's).
    """

    return status in _GRANTED_STATUSES


def effective_status(row: CapabilityRow, role: str, delegated_from_absentee: bool = False) -> str:
    """The capability status a `role` actually has. `delegated_from_absentee`
    is only meaningful for role == "tenant": it resolves a "yes_if_delegated"
    cell to "yes" (delegated) or "no" (not delegated). Every other cell for
    every other role is returned unchanged — delegation can only ever act on
    a cell explicitly marked "yes_if_delegated", and (see module docstring)
    no financial/approval/corpus/voting row is ever marked that way, so
    delegation can never reach one, by construction of this table.
    """

    base = row.grants[role]
    if role == "tenant" and base == "yes_if_delegated":
        return "yes" if delegated_from_absentee else "no"
    return base


def effective_capability(row: CapabilityRow, role: str, delegated_from_absentee: bool = False) -> bool:
    """Boolean convenience wrapper over `effective_status` / `has_access`."""

    return has_access(effective_status(row, role, delegated_from_absentee))
