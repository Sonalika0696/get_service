"""Vendor pool exposure for pooled-request scenarios.

Vendors do NOT bid (DECISIONS_V2_SCOPE.md item 4.3): the committee sources a
single vendor per category and the published pricing card (with its
volume-discount ladder) governs every participant identically. This module
simply exposes the category -> card mapping from config for the requests
engine; there is no vendor-selection logic to simulate since there is no
competition.
"""

from __future__ import annotations

from sim.config import ServiceCategory, SimParams


def categories(params: SimParams) -> tuple[ServiceCategory, ...]:
    return params.service_categories
