"""Occupancy type, delegation, and payment-behaviour assignment per flat.

Occupancy mix and payment-behaviour class weights are illustrative
assumptions (see sim/config.py OCCUPANCY_MIX, PAYMENT_BEHAVIOUR_CLASSES).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from sim.config import SimParams
from sim.synthetic.society import Flat


@dataclass(frozen=True)
class Resident:
    flat_id: str
    occupancy_type: str  # "owner_occupier" | "owner_absentee" | "tenant"
    delegated: bool  # only meaningful for owner_absentee: has the owner delegated operational capability?
    payment_behaviour: str  # one of PaymentBehaviourClass.name


def generate_residents(flats: list[Flat], params: SimParams, rng: np.random.Generator) -> list[Resident]:
    from sim import config as cfg

    occ_names = [o for o, _ in cfg.OCCUPANCY_MIX]
    occ_weights = np.array([w for _, w in cfg.OCCUPANCY_MIX])
    occ_weights = occ_weights / occ_weights.sum()

    beh_names = [b.name for b in params.payment_behaviour_classes]
    beh_weights = np.array([b.weight for b in params.payment_behaviour_classes])
    beh_weights = beh_weights / beh_weights.sum()

    residents = []
    for flat in flats:
        occ = rng.choice(occ_names, p=occ_weights)
        delegated = bool(occ == "owner_absentee" and rng.random() < cfg.ABSENTEE_DELEGATION_PROB)
        beh = rng.choice(beh_names, p=beh_weights)
        residents.append(Resident(flat_id=flat.flat_id, occupancy_type=str(occ), delegated=delegated, payment_behaviour=str(beh)))
    return residents
