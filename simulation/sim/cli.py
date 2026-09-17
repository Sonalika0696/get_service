"""CLI entrypoint: `py -3 -m sim run --scenario <name>` from `simulation/`
using the project venv interpreter (see README.md for setup).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

from sim.config import DEFAULT_PARAMS
from sim.scenarios import REGISTRY, run_scenario


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sim", description="SocietyFinTech Phase 13 offline simulation harness")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="run one (or all) scenarios and write artefacts to outputs/<scenario>/")
    run_p.add_argument("--scenario", required=True, choices=sorted(REGISTRY) + ["all"], help="scenario name, or 'all'")
    run_p.add_argument("--seed", type=int, default=DEFAULT_PARAMS.seed, help="Monte Carlo base seed (default: %(default)s)")
    run_p.add_argument("--out", type=Path, default=Path("outputs"), help="output root directory (default: %(default)s)")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "run":
        params = replace(DEFAULT_PARAMS, seed=args.seed)
        names = sorted(REGISTRY) if args.scenario == "all" else [args.scenario]
        for name in names:
            print(f"Running scenario '{name}' (seed={params.seed})...")
            payload = run_scenario(name, params)
            from sim.analysis.report import write_run

            out_dir = write_run(name, params, payload, args.out)
            print(f"  wrote artefacts to {out_dir}")
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
