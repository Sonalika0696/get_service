import { describe, expect, it } from 'vitest';
import { BbpsService } from './bbps.service.js';

function makeService(): BbpsService {
  return new BbpsService();
}

describe('BbpsService (stub mode, BBPS_ENABLED=false)', () => {
  it('is deterministic: same consumerNumber + utility -> same bill', async () => {
    const service = makeService();
    const first = await service.fetchBill({ consumerNumber: 'CN-1001', utility: 'ELECTRICITY' });
    const second = await service.fetchBill({ consumerNumber: 'CN-1001', utility: 'ELECTRICITY' });
    expect(second).toEqual(first);
  });

  it('produces different bills for different consumer numbers', async () => {
    const service = makeService();
    const a = await service.fetchBill({ consumerNumber: 'CN-1001', utility: 'ELECTRICITY' });
    const b = await service.fetchBill({ consumerNumber: 'CN-2002', utility: 'ELECTRICITY' });
    expect(a.billNumber).not.toBe(b.billNumber);
    expect(a.amountPaise).not.toBe(b.amountPaise);
  });

  it('produces a different bill for the same consumer number under a different utility', async () => {
    const service = makeService();
    const electricity = await service.fetchBill({ consumerNumber: 'CN-1001', utility: 'ELECTRICITY' });
    const water = await service.fetchBill({ consumerNumber: 'CN-1001', utility: 'WATER' });
    expect(electricity.billNumber).not.toBe(water.billNumber);
  });

  it('supports both utilities with the right biller name', async () => {
    const service = makeService();
    const electricity = await service.fetchBill({ consumerNumber: 'CN-3003', utility: 'ELECTRICITY' });
    const water = await service.fetchBill({ consumerNumber: 'CN-3003', utility: 'WATER' });
    expect(electricity.utility).toBe('ELECTRICITY');
    expect(electricity.billerName).toMatch(/Electricity/);
    expect(water.utility).toBe('WATER');
    expect(water.billerName).toMatch(/Water/);
  });

  it('returns a positive integer amountPaise', async () => {
    const service = makeService();
    const bill = await service.fetchBill({ consumerNumber: 'CN-4004', utility: 'WATER' });
    expect(Number.isInteger(bill.amountPaise)).toBe(true);
    expect(bill.amountPaise).toBeGreaterThan(0);
  });

  it('has a dueDate strictly after billDate', async () => {
    const service = makeService();
    const bill = await service.fetchBill({ consumerNumber: 'CN-5005', utility: 'ELECTRICITY' });
    expect(new Date(bill.dueDate).getTime()).toBeGreaterThan(new Date(bill.billDate).getTime());
  });

  it('echoes back the requested consumerNumber and a well-formed billNumber', async () => {
    const service = makeService();
    const bill = await service.fetchBill({ consumerNumber: 'CN-6006', utility: 'ELECTRICITY' });
    expect(bill.consumerNumber).toBe('CN-6006');
    expect(bill.billNumber).toMatch(/^BBPS-\d{6}-[A-F0-9]{10}$/);
  });
});
