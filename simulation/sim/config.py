"""
Central parameter module for the Phase 13 simulation harness.

EVERY numeric assumption in this file is SYNTHETIC and ILLUSTRATIVE. None of
it is sourced from a real DISCOM tariff order, a real vendor price list, a
real bank FD rate sheet, or any real society's accounts. Each value below
carries an inline comment saying so. The dissertation's evaluation is
internally consistent (the simulation's own arithmetic is correct and its
qualitative conclusions are robust across the sensitivity sweeps) but is NOT
externally calibrated to any specific regulator, DISCOM, state, or society.

Where a tariff-like structure is needed, this module encodes an "illustrative
reference regime" loosely shaped like how Indian DISCOMs publish domestic/
commercial/HT tariff orders (telescoping slabs, fixed charges, duty/cess for
LT; a two-part demand + energy charge for HT) -- but the specific numbers are
invented for this dissertation and must not be read as any regulator's actual
tariff.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional


# ---------------------------------------------------------------------------
# Reference society
# ---------------------------------------------------------------------------

N_FLATS = 90  # Phase 13 checklist: "90-flat reference society". Illustrative mid-size urban housing society.
HORIZON_MONTHS = 12  # Phase 13 checklist: twelve-month horizon.

# Flat carpet area in sqft, drawn from a truncated normal distribution.
# Illustrative assumption: mid-size Indian metro housing society mix of 1/2/3 BHK units.
FLAT_AREA_MEAN_SQFT = 850.0
FLAT_AREA_STD_SQFT = 260.0
FLAT_AREA_MIN_SQFT = 380.0
FLAT_AREA_MAX_SQFT = 1900.0

# Monte Carlo control: run iterations until the reported 95% CI half-width is
# within this fraction of the mean (relative tolerance), or MAX_MC_ITERATIONS
# is reached, whichever comes first. Illustrative engineering choice, not a
# statistical claim.
MC_STABILITY_REL_TOL = 0.01
MC_MIN_ITERATIONS = 50
MC_MAX_ITERATIONS = 2000
MC_CHECK_EVERY = 50

DEFAULT_SEED = 20240913  # Arbitrary fixed seed for reproducibility; overridable via CLI.


# ---------------------------------------------------------------------------
# Electricity — illustrative reference tariff regime
# ---------------------------------------------------------------------------
# NOTE: the reference tariff regime for Indian residential electricity is an
# OPEN question for this project (state DISCOMs differ materially). The
# numbers below are an "illustrative reference regime" only, loosely shaped
# like a typical urban domestic/commercial slab tariff plus a separate HT
# (high-tension, bulk-supply) tariff for large connected loads such as a
# group-housing society. They are NOT any real regulator's published tariff.


@dataclass(frozen=True)
class Slab:
    """One band of a telescoping (block) tariff. `up_to=None` = open-ended final slab."""

    up_to: Optional[float]  # cumulative units (kWh) ceiling, inclusive; None = unbounded
    rate: float  # Rs per unit (kWh) for consumption within this slab's band


@dataclass(frozen=True)
class ElectricityTariff:
    slabs: tuple  # tuple[Slab, ...], ascending, non-overlapping, mirrors backend TariffConfig.slabs
    fixed_charge_per_connection: float  # Rs per billing cycle, flat
    fixed_charge_per_kw: float  # Rs per kW of sanctioned load, flat
    sanctioned_load_kw: float  # kW of contracted/sanctioned load this connection carries
    energy_duty_pct: float  # % of energy charge, government levy
    fixed_cess: float  # Rs flat cess per billing cycle
    demand_charge_per_kva: float = 0.0  # HT only: Rs per kVA of contract demand, per month


# LT (low-tension) domestic tariff — what an individually-metered flat pays on
# its OWN connection if the society does not aggregate under one HT
# connection. Illustrative telescoping domestic slab structure.
LT_TARIFF = ElectricityTariff(
    slabs=(
        Slab(up_to=100, rate=3.50),   # illustrative assumption: lifeline/first slab
        Slab(up_to=300, rate=6.00),   # illustrative assumption
        Slab(up_to=500, rate=8.20),   # illustrative assumption
        Slab(up_to=None, rate=9.80),  # illustrative assumption: open-ended top slab
    ),
    fixed_charge_per_connection=120.0,  # illustrative assumption: Rs/month per LT connection
    fixed_charge_per_kw=0.0,            # domestic LT typically has no separate kW charge in this reference regime
    sanctioned_load_kw=5.0,             # illustrative assumption: typical domestic sanctioned load
    energy_duty_pct=6.0,                # illustrative assumption: state electricity duty
    fixed_cess=25.0,                    # illustrative assumption: flat cess/month
)

# HT (high-tension) bulk-supply tariff — what the SOCIETY pays on a single
# aggregated HT connection covering the whole building's load (all flats +
# common areas), then apportions internally. Illustrative commercial/HT
# demand+energy structure: lower per-unit energy rate, but a separate demand
# (capacity) charge based on contracted kVA.
HT_TARIFF = ElectricityTariff(
    slabs=(
        Slab(up_to=None, rate=6.90),  # illustrative assumption: flat HT energy rate (no telescoping at HT)
    ),
    fixed_charge_per_connection=1500.0,  # illustrative assumption: single HT connection fixed charge/month
    fixed_charge_per_kw=0.0,
    sanctioned_load_kw=0.0,
    energy_duty_pct=4.0,   # illustrative assumption: HT duty typically lower than LT domestic
    fixed_cess=0.0,
    demand_charge_per_kva=320.0,  # illustrative assumption: Rs per kVA of contract demand, per month
)

# Per-flat monthly consumption profile (kWh). Log-normal with a seasonal
# multiplier (illustrative Indian residential AC-driven summer peak).
FLAT_CONSUMPTION_MEAN_KWH = 220.0  # illustrative assumption
FLAT_CONSUMPTION_SIGMA = 0.35      # log-normal shape parameter, illustrative
SEASONAL_MULTIPLIER = (           # Jan..Dec, illustrative Indian summer-AC seasonality
    0.85, 0.85, 0.95, 1.15, 1.35, 1.40,
    1.25, 1.15, 1.05, 0.90, 0.80, 0.80,
)

# Common-area load as a fraction of TOTAL society consumption (lifts, pumps,
# corridor lighting, transformer/line losses). Illustrative assumption;
# swept explicitly in the electricity-sensitivity scenario.
COMMON_AREA_LOAD_FRACTION = 0.14

# Society's contracted HT demand, in kVA, derived at run time from the
# generated flats' consumption but bounded by this illustrative minimum.
HT_MIN_CONTRACT_DEMAND_KVA = 45.0

# Regulatory cap on the margin a society may recover when it apportions
# HT-sourced bulk power cost onto residents above the underlying per-unit
# cost (some states treat a group-housing society acting as a bulk consumer
# as a "deemed distributor" and cap the resale margin it may add). This is a
# SENSITIVITY PARAMETER, not a claim about any specific state's regulation —
# the reference regime is explicitly open (see module docstring). 0.0 = the
# society may recover cost only, no margin.
REGULATORY_MARGIN_CAP_FRACTION = 0.02  # illustrative assumption: 2% cap, swept in electricity_sensitivity


# ---------------------------------------------------------------------------
# Water — seasonal municipal / tanker / borewell blend
# ---------------------------------------------------------------------------

FLAT_WATER_MEAN_KL = 9.0  # illustrative assumption: kilolitres/month per flat
FLAT_WATER_SIGMA = 0.25

# Municipal supply share of total demand by month (Jan..Dec). Illustrative
# assumption: municipal share falls in summer (Apr-Jun) when the utility
# itself is supply-constrained, pushing the society onto costlier tanker
# water; borewell fills a small, roughly constant share year-round.
MUNICIPAL_SHARE_BY_MONTH = (
    0.75, 0.72, 0.60, 0.45, 0.40, 0.45,
    0.65, 0.75, 0.78, 0.78, 0.76, 0.75,
)
BOREWELL_SHARE_BY_MONTH = (0.15,) * 12  # illustrative assumption: constant borewell contribution
# Tanker share = 1 - municipal - borewell (residual), computed at run time.

MUNICIPAL_COST_PER_KL = 22.0   # illustrative assumption, Rs/kl (utility-billed)
TANKER_COST_PER_KL = 85.0      # illustrative assumption, Rs/kl (private tanker, materially costlier)
BOREWELL_COST_PER_KL = 14.0    # illustrative assumption, Rs/kl (electricity + upkeep only)

# Probability, per month, that municipal supply is INTERRUPTED for that
# whole month (forcing 100% reliance on tanker + borewell that month).
# Illustrative assumption, swept explicitly in the water_volatility scenario.
MUNICIPAL_INTERRUPTION_PROB = 0.06


# ---------------------------------------------------------------------------
# Pooled service requests / collective procurement (no vendor bidding —
# DECISIONS_V2_SCOPE.md item 4.3: vendor is sourced by the committee, not
# competitively bid; the saving modelled here is the AGGREGATION/VOLUME
# effect only, against a single published pricing card per category)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ServiceCategory:
    name: str
    threshold: int  # minimum participants for the pool to proceed (RoU M7)
    card_rate_per_flat: float  # Rs, the vendor's published per-flat card rate at zero discount
    # Volume discount ladder: list of (min_participants, discount_fraction),
    # ascending by min_participants, applied to the card rate. Illustrative
    # assumption standing in for "aggregation saving", since vendors do not
    # bid (DECISIONS_V2_SCOPE.md 4.3) — there is no price-competition effect
    # to model, only this volume ladder.
    discount_ladder: tuple = field(default_factory=tuple)


SERVICE_CATEGORIES = (
    # Illustrative assumption: emergency plumbing proceeds even at 1 participant, small ladder.
    ServiceCategory(
        name="plumbing_emergency",
        threshold=1,
        card_rate_per_flat=650.0,
        discount_ladder=((1, 0.00), (3, 0.05), (6, 0.10)),
    ),
    # Illustrative assumption: pest control needs modest aggregation.
    ServiceCategory(
        name="pest_control",
        threshold=3,
        card_rate_per_flat=900.0,
        discount_ladder=((3, 0.00), (6, 0.08), (12, 0.15), (24, 0.22)),
    ),
    # Illustrative assumption: AMC (annual maintenance contracts, e.g. lift/DG servicing add-ons opted per flat).
    ServiceCategory(
        name="amc_addon",
        threshold=5,
        card_rate_per_flat=1400.0,
        discount_ladder=((5, 0.00), (10, 0.10), (20, 0.18), (40, 0.25)),
    ),
    # Illustrative assumption: bulk festival/grocery order, biggest ladder, biggest threshold.
    ServiceCategory(
        name="bulk_grocery",
        threshold=15,
        card_rate_per_flat=500.0,
        discount_ladder=((15, 0.00), (30, 0.12), (50, 0.20), (75, 0.28)),
    ),
)


# ---------------------------------------------------------------------------
# Resident payment behaviour / collections
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PaymentBehaviourClass:
    name: str
    weight: float  # population share
    on_time_prob: float  # probability of paying within the due month
    mean_delay_months: float  # if late, expected additional months before payment
    default_prob: float  # probability the dues are never paid within the 12-month horizon


# Illustrative assumption: three behaviour archetypes in an Indian resident population.
PAYMENT_BEHAVIOUR_CLASSES = (
    PaymentBehaviourClass("prompt", weight=0.55, on_time_prob=0.95, mean_delay_months=0.5, default_prob=0.005),
    PaymentBehaviourClass("moderate", weight=0.35, on_time_prob=0.65, mean_delay_months=1.5, default_prob=0.02),
    PaymentBehaviourClass("delinquent", weight=0.10, on_time_prob=0.25, mean_delay_months=3.5, default_prob=0.12),
)

MONTHLY_DUE_PER_FLAT = 3500.0  # illustrative assumption: combined maintenance + utility due, Rs/month
LATE_FEE_PCT_PER_MONTH_OVERDUE = 1.5  # illustrative assumption: simple monthly late fee, % of overdue amount
ARREARS_AGEING_BUCKETS_DAYS = (30, 60, 90)  # bucket edges: 0-30, 31-60, 61-90, 90+


# ---------------------------------------------------------------------------
# Occupancy mix (for the access-control matrix and delegation checks)
# ---------------------------------------------------------------------------

OCCUPANCY_MIX = (
    ("owner_occupier", 0.55),   # illustrative assumption
    ("owner_absentee", 0.20),   # illustrative assumption
    ("tenant", 0.25),           # illustrative assumption
)
ABSENTEE_DELEGATION_PROB = 0.7  # illustrative assumption: fraction of absentee owners who delegate to a tenant/agent


# ---------------------------------------------------------------------------
# Corpus / treasury — laddered fixed-deposit sweep
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FdTranche:
    tenor_months: int
    annual_rate_pct: float  # illustrative assumption: bank FD rate for that tenor


# Illustrative assumption: a simple 4-rung ladder (3/6/9/12 month tenors),
# rates loosely shaped like Indian scheduled-bank FD rates circa the
# dissertation's writing, NOT sourced from any specific bank's rate sheet.
FD_LADDER = (
    FdTranche(tenor_months=3, annual_rate_pct=6.5),
    FdTranche(tenor_months=6, annual_rate_pct=6.9),
    FdTranche(tenor_months=9, annual_rate_pct=7.1),
    FdTranche(tenor_months=12, annual_rate_pct=7.3),
)

OPERATING_FLOAT_FLOOR_MONTHS = 2.0  # illustrative assumption: months of average outflow kept liquid, never laddered
CORPUS_STARTING_MONTHS_OF_DUES = 6.0  # illustrative assumption: corpus sized as multiple of one month's dues at t=0

# Seasonal cash calls: (month_index[0-11], multiple_of_monthly_dues). Illustrative
# assumption: property tax, AMC renewal and festival advance create lumpy
# seasonal outflows on top of routine opex. Each configured call is itself
# STOCHASTIC at run time (see SEASONAL_CASH_CALL_SIZE_SIGMA / CASH_CALL_MONTH_JITTER
# below) — the tuple below gives each call's illustrative EXPECTED month and size.
SEASONAL_CASH_CALLS = (
    (3, 2.5),   # illustrative assumption: AMC renewal, month 4
    (6, 3.0),   # illustrative assumption: property tax instalment, month 7
    (9, 1.5),   # illustrative assumption: festival advance/bonus payouts, month 10
)

# Orchestrator review fix: a seasonal cash call's actual size varies year to
# year (a property-tax instalment or AMC renewal is rarely exactly the
# budgeted figure). Log-normal multiplicative noise around the configured
# multiple. Illustrative assumption, not sourced from any real society's
# accounts.
SEASONAL_CASH_CALL_SIZE_SIGMA = 0.15

# A cash call can land a month earlier or later than budgeted (e.g. a
# property-tax due date shifting, an AMC renewal slipping). Illustrative
# assumption: uniform integer jitter of at most this many months either way.
CASH_CALL_MONTH_JITTER_MONTHS = 1

# FD rates drift a little at each renewal rather than staying fixed for the
# whole horizon (a real bank's card rate moves with the repo rate). Modelled
# as independent-per-month normal noise, in PERCENTAGE POINTS, added to the
# rung's configured annual_rate_pct at every rollover; the effective rate is
# floored at 0. Illustrative assumption.
FD_RATE_DRIFT_SIGMA_PCT_POINTS = 0.10

# Rate earned on money that is NOT locked in an FD (the operating float
# floor under every strategy, and the entire corpus under ALL_LIQUID).
# Illustrative assumption: a savings/liquid sweep account rate, materially
# below any FD tenor's rate — this is what makes "keep everything liquid"
# a real trade-off rather than a free lunch in the strategy comparison.
LIQUID_SAVINGS_RATE_PCT = 3.5

# Fraction of the month's RAISED dues that is actually spent on routine
# opex (maintenance staff, utilities, day-to-day running costs), as
# distinct from the FULL amount raised (some of which is late-paid,
# building the float, or represents dues never yet collected in that
# month). Orchestrator review fix: the previous model subtracted the FULL
# monthly dues figure regardless of the ~97-98% collection rate, which
# manufactured a structural ~2%/month float drain and made every
# "shortfall" an artefact of that mismatch rather than of the ladder
# itself. Illustrative assumption, swept in the corpus_sweep scenario.
OPEX_FRACTION_OF_DUES = 0.88

# When a seasonal cash call cannot be met from the liquid float alone, a
# strategy may prematurely break its soonest-maturing FD rather than
# default. The bank penalises early withdrawal by cutting the rate for the
# days actually held, mirroring a standard premature-withdrawal clause
# (and the RoU's own laddered-placement design, which assumes withdrawal
# is possible but costly, not free). Expressed in PERCENTAGE POINTS off
# the rung's annual rate; floored at 0 (never a negative rate). Illustrative
# assumption.
PREMATURE_WITHDRAWAL_PENALTY_PCT_POINTS = 1.00

TREASURY_STRATEGIES = ("all_liquid", "single_maturity", "laddered")


@dataclass(frozen=True)
class SimParams:
    """Bundles every sweepable/overridable parameter for a single run. Scenario
    functions construct one of these (typically `replace(DEFAULT_PARAMS, ...)`)
    and the engine takes only this object, never module globals directly, so
    a run's full parameter set can be written verbatim to run_manifest.json.
    """

    n_flats: int = N_FLATS
    horizon_months: int = HORIZON_MONTHS
    seed: int = DEFAULT_SEED

    lt_tariff: ElectricityTariff = LT_TARIFF
    ht_tariff: ElectricityTariff = HT_TARIFF
    common_area_load_fraction: float = COMMON_AREA_LOAD_FRACTION
    regulatory_margin_cap_fraction: float = REGULATORY_MARGIN_CAP_FRACTION
    flat_consumption_mean_kwh: float = FLAT_CONSUMPTION_MEAN_KWH
    flat_consumption_sigma: float = FLAT_CONSUMPTION_SIGMA

    flat_water_mean_kl: float = FLAT_WATER_MEAN_KL
    flat_water_sigma: float = FLAT_WATER_SIGMA
    municipal_interruption_prob: float = MUNICIPAL_INTERRUPTION_PROB

    service_categories: tuple = SERVICE_CATEGORIES
    participation_rate: float = 0.55  # illustrative assumption: default share of flats that join an eligible pool

    payment_behaviour_classes: tuple = PAYMENT_BEHAVIOUR_CLASSES
    monthly_due_per_flat: float = MONTHLY_DUE_PER_FLAT

    fd_ladder: tuple = FD_LADDER
    operating_float_floor_months: float = OPERATING_FLOAT_FLOOR_MONTHS
    corpus_starting_months_of_dues: float = CORPUS_STARTING_MONTHS_OF_DUES
    seasonal_cash_calls: tuple = SEASONAL_CASH_CALLS
    seasonal_cash_call_size_sigma: float = SEASONAL_CASH_CALL_SIZE_SIGMA
    cash_call_month_jitter_months: int = CASH_CALL_MONTH_JITTER_MONTHS
    fd_rate_drift_sigma_pct_points: float = FD_RATE_DRIFT_SIGMA_PCT_POINTS
    liquid_savings_rate_pct: float = LIQUID_SAVINGS_RATE_PCT
    opex_fraction_of_dues: float = OPEX_FRACTION_OF_DUES
    premature_withdrawal_penalty_pct_points: float = PREMATURE_WITHDRAWAL_PENALTY_PCT_POINTS
    treasury_strategies: tuple = TREASURY_STRATEGIES

    mc_min_iterations: int = MC_MIN_ITERATIONS
    mc_max_iterations: int = MC_MAX_ITERATIONS
    mc_check_every: int = MC_CHECK_EVERY
    mc_stability_rel_tol: float = MC_STABILITY_REL_TOL


DEFAULT_PARAMS = SimParams()


def with_overrides(**kwargs) -> SimParams:
    """Convenience: `with_overrides(participation_rate=0.8)` etc."""

    return replace(DEFAULT_PARAMS, **kwargs)
