from sim.engine.ledger import JournalEntry, Ledger


def test_ledger_balances_by_construction():
    ledger = Ledger()
    ledger.post(JournalEntry("k1", "receivable:F001", "income:electricity", 10_000))
    ledger.post(JournalEntry("k2", "receivable:F002", "income:electricity", 5_000))
    assert ledger.balance("receivable:F001") == 10_000
    assert ledger.balance("receivable:F002") == 5_000
    assert ledger.balance("income:electricity") == -15_000
    assert ledger.is_balanced()


def test_replayed_idempotency_key_is_a_noop():
    ledger = Ledger()
    entry = JournalEntry("dup", "a", "b", 999)
    assert ledger.post(entry) is True
    assert ledger.post(entry) is False
    assert ledger.post(entry) is False
    assert ledger.balance("a") == 999
