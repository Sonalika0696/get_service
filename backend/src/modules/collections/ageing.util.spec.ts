import { describe, expect, it } from 'vitest';
import { ARREARS_BUCKETS, bucketOf, daysOverdue, outstandingOf } from './ageing.util.js';

describe('ageing.util', () => {
  describe('outstandingOf', () => {
    it('sums amount + lateFeeAccrued - paidAmount', () => {
      expect(outstandingOf(1000, 50, 200)).toBe(850);
    });

    it('never goes negative when overpaid', () => {
      expect(outstandingOf(1000, 0, 1500)).toBe(0);
    });

    it('is zero for a fully paid charge', () => {
      expect(outstandingOf(1000, 20, 1020)).toBe(0);
    });

    it('keeps 2dp precision without float drift', () => {
      expect(outstandingOf(1000.1, 0.05, 0)).toBeCloseTo(1000.15, 2);
      expect(outstandingOf(0.1, 0.2, 0)).toBe(0.3);
    });
  });

  describe('daysOverdue', () => {
    it('is negative when not yet due', () => {
      const dueDate = new Date('2026-09-20T00:00:00.000Z');
      const now = new Date('2026-09-17T00:00:00.000Z');
      expect(daysOverdue(dueDate, now)).toBe(-3);
    });

    it('is zero on the due date itself', () => {
      const d = new Date('2026-09-17T00:00:00.000Z');
      expect(daysOverdue(d, d)).toBe(0);
    });

    it('counts whole days past due', () => {
      const dueDate = new Date('2026-09-01T00:00:00.000Z');
      const now = new Date('2026-10-01T00:00:00.000Z');
      expect(daysOverdue(dueDate, now)).toBe(30);
    });
  });

  describe('bucketOf — exhaustive boundaries', () => {
    it('buckets a negative days-overdue as NOT_YET_DUE', () => {
      expect(bucketOf(-1)).toBe('NOT_YET_DUE');
      expect(bucketOf(-100)).toBe('NOT_YET_DUE');
    });

    it('buckets 0 through 30 as 0_30', () => {
      expect(bucketOf(0)).toBe('0_30');
      expect(bucketOf(1)).toBe('0_30');
      expect(bucketOf(30)).toBe('0_30');
    });

    it('buckets 31 through 60 as 31_60', () => {
      expect(bucketOf(31)).toBe('31_60');
      expect(bucketOf(45)).toBe('31_60');
      expect(bucketOf(60)).toBe('31_60');
    });

    it('buckets 61 through 90 as 61_90', () => {
      expect(bucketOf(61)).toBe('61_90');
      expect(bucketOf(75)).toBe('61_90');
      expect(bucketOf(90)).toBe('61_90');
    });

    it('buckets 91+ as 90_PLUS', () => {
      expect(bucketOf(91)).toBe('90_PLUS');
      expect(bucketOf(365)).toBe('90_PLUS');
    });

    it('exposes every bucket name in ARREARS_BUCKETS, in ageing order', () => {
      expect(ARREARS_BUCKETS).toEqual(['NOT_YET_DUE', '0_30', '31_60', '61_90', '90_PLUS']);
    });
  });
});
