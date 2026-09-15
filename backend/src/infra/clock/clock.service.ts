import { Injectable } from '@nestjs/common';

/**
 * Indirection around `Date.now()` so tests can inject a fixed or
 * fast-forwardable clock instead of depending on wall-clock time
 * (needed for deterministic tests of deadlines, expiry, auto-archive, etc.).
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
