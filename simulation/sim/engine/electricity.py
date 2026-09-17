"""Electricity billing engine: telescoping-slab tariff computation, common-area
apportionment by area with deterministic largest-remainder residue, and the
principal HT-bulk-vs-aggregate-LT cost comparison.

Mirrors, in Python, the semantics of the backend's pure billing logic (read
for reference, not imported — this is an offline simulation with no
dependency on the TypeScript backend):
  - backend/src/modules/electricity/tariff/tariff.util.ts   (telescoping slabs, fixed charges, duty/cess)
  - backend/src/modules/electricity/apportionment/apportionment.util.ts (largest-remainder area apportionment)

Money is kept in integer PAISE throughout, exactly as the backend does, so
that "billing correctness at slab boundaries" and "apportionment sums to the
residual with deterministic residue" (Phase 13 functional-accuracy checklist)
are provable to the paise, not merely to a floating-point tolerance.
"""

from __future__ import annotations

from dataclasses import dataclass

from sim.config import ElectricityTariff

PAISE_PER_RUPEE = 100


def to_paise(rupees: float) -> int:
    """Round-half-up to integer paise (mirrors backend toPaise)."""

    return int(rupees * PAISE_PER_RUPEE + (0.5 if rupees >= 0 else -0.5))


def from_paise(paise: int) -> float:
    return paise / PAISE_PER_RUPEE


@dataclass(frozen=True)
class SlabCharge:
    from_unit: float
    to_unit: float
    units: float
    rate: float
    charge_paise: int


@dataclass(frozen=True)
class TariffBreakdown:
    consumption_units: float
    energy_charge_paise: int
    slab_breakdown: tuple
    fixed_charge_paise: int
    demand_charge_paise: int
    duty_cess_paise: int
    total_paise: int


def compute_tariff(tariff: ElectricityTariff, consumption_units: float, contract_demand_kva: float = 0.0) -> TariffBreakdown:
    """Telescoping slab walk identical in structure to tariff.util.ts's
    computeSlabCharges + computeTariff: each slab is billed only for the
    portion of consumption within its own band; a slab whose band lies
    entirely above consumption contributes 0 and is omitted from the
    breakdown. `consumption_units <= 0` still bills fixed/demand/cess
    components (a connection is billed its fixed components even with zero
    consumption), matching the backend's documented edge-case behaviour.
    """

    effective_units = max(0.0, consumption_units)
    slab_breakdown = []
    energy_charge_paise = 0
    previous_up_to = 0.0

    for slab in tariff.slabs:
        band_ceiling = float("inf") if slab.up_to is None else float(slab.up_to)
        units_in_slab = max(0.0, min(effective_units, band_ceiling) - previous_up_to)
        if units_in_slab > 0:
            charge_paise = to_paise(units_in_slab * slab.rate)
            slab_breakdown.append(
                SlabCharge(
                    from_unit=previous_up_to + 1,
                    to_unit=previous_up_to + units_in_slab,
                    units=units_in_slab,
                    rate=slab.rate,
                    charge_paise=charge_paise,
                )
            )
            energy_charge_paise += charge_paise
        previous_up_to = band_ceiling
        if effective_units <= band_ceiling:
            break

    fixed_charge_paise = to_paise(tariff.fixed_charge_per_connection) + to_paise(tariff.fixed_charge_per_kw * tariff.sanctioned_load_kw)
    demand_charge_paise = to_paise(tariff.demand_charge_per_kva * contract_demand_kva)

    energy_duty_paise = round(energy_charge_paise * tariff.energy_duty_pct / 100.0)
    fixed_cess_paise = to_paise(tariff.fixed_cess)
    duty_cess_paise = energy_duty_paise + fixed_cess_paise

    total_paise = energy_charge_paise + fixed_charge_paise + demand_charge_paise + duty_cess_paise

    return TariffBreakdown(
        consumption_units=consumption_units,
        energy_charge_paise=energy_charge_paise,
        slab_breakdown=tuple(slab_breakdown),
        fixed_charge_paise=fixed_charge_paise,
        demand_charge_paise=demand_charge_paise,
        duty_cess_paise=duty_cess_paise,
        total_paise=total_paise,
    )


def derive_common_consumption(bulk_units: float, sub_meter_sum_units: float) -> float:
    """Mirrors apportionment.util.ts deriveCommonConsumption: floored at zero."""

    return max(0.0, bulk_units - sub_meter_sum_units)


def apportion_by_area(amount_paise: int, area_weights: list[float], flat_ids: list[str]) -> dict[str, int]:
    """Largest-remainder apportionment identical in method to
    apportionByArea in apportionment.util.ts: floor each flat's ideal share,
    then hand out the leftover paise one at a time to the largest fractional
    remainders (ties broken by flat_id ascending), guaranteeing
    sum(shares) == amount_paise exactly for every input.
    """

    n = len(flat_ids)
    if n == 0:
        return {}
    if n == 1:
        return {flat_ids[0]: amount_paise}

    total_weight = sum(area_weights)
    if total_weight <= 0:
        area_weights = [1.0] * n
        total_weight = float(n)

    ideal = [amount_paise * w / total_weight for w in area_weights]
    base = [int(x) for x in ideal]  # floor for non-negative x
    remainder = [ideal[i] - base[i] for i in range(n)]
    base_sum = sum(base)
    leftover = amount_paise - base_sum

    order = sorted(range(n), key=lambda i: (-remainder[i], flat_ids[i]))

    shares = list(base)
    if leftover > 0:
        for k in range(len(order)):
            if leftover <= 0:
                break
            shares[order[k]] += 1
            leftover -= 1
    elif leftover < 0:
        for k in range(len(order) - 1, -1, -1):
            if leftover >= 0:
                break
            shares[order[k]] -= 1
            leftover += 1

    return {flat_ids[i]: shares[i] for i in range(n)}


@dataclass(frozen=True)
class HtVsLtResult:
    ht_bulk_total_paise: int
    lt_aggregate_total_paise: int
    saving_paise: int
    saving_pct: float
    recoverable_saving_paise: int  # after applying the regulatory margin cap to the society's admin overhead recovery


def compare_ht_vs_lt(
    flat_consumption_kwh: list[float],
    common_area_kwh: float,
    lt_tariff: ElectricityTariff,
    ht_tariff: ElectricityTariff,
    regulatory_margin_cap_fraction: float,
    common_area_admin_overhead_pct: float = 3.0,
) -> HtVsLtResult:
    """Principal economic result (Phase 13 checklist item 2 / RoU B12):

    - LT aggregate: every flat on its own individually-metered LT
      connection, PLUS a separate LT connection dedicated to common-area
      load (the status quo for most unaggregated societies in this
      reference regime — someone still has to power the lifts/pumps).
    - HT bulk: one HT connection sized to the sum of all load (flats +
      common area), apportioned back to flats by area weight for the
      common-area component, energy metered at the (materially cheaper,
      per this illustrative reference regime) HT rate.

    `recoverable_saving_paise` applies the regulatory cap: the society may
    add at most `regulatory_margin_cap_fraction` of the HT bulk cost as
    admin-overhead recovery when re-billing residents (DOC_AMENDMENTS_V2.md
    RoU §7.6: no commission is taken; here the cap models a distinct,
    externally-imposed ceiling on cost-recovery margin, separate from the
    platform's own zero-commission policy). It does not change the
    underlying cost saving, only how much of it the society may formally
    mark up when apportioning administrative overhead.
    """

    ht_total_kwh = sum(flat_consumption_kwh) + common_area_kwh
    contract_demand_kva = max(45.0, ht_total_kwh / 24.0 / 30.0 * 1.15)  # illustrative assumption: peak demand estimate from average load, +15% headroom
    ht_breakdown = compute_tariff(ht_tariff, ht_total_kwh, contract_demand_kva=contract_demand_kva)
    ht_bulk_total_paise = ht_breakdown.total_paise

    lt_flats_total_paise = sum(compute_tariff(lt_tariff, kwh).total_paise for kwh in flat_consumption_kwh)
    lt_common_breakdown = compute_tariff(lt_tariff, common_area_kwh)
    lt_aggregate_total_paise = lt_flats_total_paise + lt_common_breakdown.total_paise

    saving_paise = lt_aggregate_total_paise - ht_bulk_total_paise
    saving_pct = (saving_paise / lt_aggregate_total_paise * 100.0) if lt_aggregate_total_paise > 0 else 0.0

    margin_cap_paise = to_paise_int(ht_bulk_total_paise * regulatory_margin_cap_fraction)
    recoverable_saving_paise = min(saving_paise, saving_paise) if saving_paise <= margin_cap_paise else saving_paise
    # The cap bounds the ADMIN-OVERHEAD portion the society may add on top of
    # pass-through cost; it does not claw back a genuine pass-through cost
    # saving (which is not a "margin" — it is what the society actually paid
    # the DISCOM). We report both the full saving and, separately, how much
    # of an admin-overhead recovery the cap would allow, capped explicitly.
    admin_overhead_wanted_paise = to_paise_int(ht_bulk_total_paise * common_area_admin_overhead_pct / 100.0)
    recoverable_saving_paise = saving_paise + min(admin_overhead_wanted_paise, margin_cap_paise)

    return HtVsLtResult(
        ht_bulk_total_paise=ht_bulk_total_paise,
        lt_aggregate_total_paise=lt_aggregate_total_paise,
        saving_paise=saving_paise,
        saving_pct=saving_pct,
        recoverable_saving_paise=recoverable_saving_paise,
    )


def to_paise_int(x: float) -> int:
    return int(round(x))
