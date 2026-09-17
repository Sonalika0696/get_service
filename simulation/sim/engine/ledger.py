"""A minimal double-entry ledger mirroring the backend's invariants (see
backend M13 / invariant I6: balances are derived by query, never a stored,
independently-writable field), used by the treasury/collections engines and
by the functional-accuracy idempotency test.

All money is kept in integer PAISE (Rs 1 = 100 paise), matching the backend's
money-determinism convention in tariff.util.ts / apportionment.util.ts.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class JournalEntry:
    idempotency_key: str
    debit_account: str
    credit_account: str
    amount_paise: int
    memo: str = ""


class Ledger:
    """Append-only. `post` is idempotent: replaying an entry with an
    already-seen idempotency_key is a silent no-op (mirrors the backend's
    idempotency-key-on-journal-entries invariant), never a duplicate posting.
    """

    def __init__(self) -> None:
        self._entries: list[JournalEntry] = []
        self._seen_keys: set[str] = set()

    def post(self, entry: JournalEntry) -> bool:
        """Returns True if the entry was newly posted, False if it was a
        duplicate (same idempotency_key) and therefore skipped.
        """

        if entry.idempotency_key in self._seen_keys:
            return False
        self._entries.append(entry)
        self._seen_keys.add(entry.idempotency_key)
        return True

    @property
    def entries(self) -> tuple:
        return tuple(self._entries)

    def balance(self, account: str) -> int:
        """Derived balance in paise: debits increase, credits decrease, for
        the given account, purely by summing over posted entries — there is
        no separately stored/mutable balance field anywhere in this class.
        """

        total = 0
        for e in self._entries:
            if e.debit_account == account:
                total += e.amount_paise
            if e.credit_account == account:
                total -= e.amount_paise
        return total

    def is_balanced(self) -> bool:
        """Every entry is a balanced two-sided posting by construction (a
        single amount moved from credit_account to debit_account), so the
        ledger-wide conservation check is that the sum of ALL account
        balances is exactly zero.
        """

        accounts = {e.debit_account for e in self._entries} | {e.credit_account for e in self._entries}
        return sum(self.balance(a) for a in accounts) == 0
