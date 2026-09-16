import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Thin wrapper around argon2 (argon2id, the library's default — preferred
 * over bcrypt per the project's KDF requirement for Phase 6.2's
 * password + TOTP officer/vendor credential path, see
 * DECISIONS_V2_SCOPE.md §7.2). Never stores or logs a raw password; only
 * the argon2 hash (itself salted and tagged with its own parameters) is
 * persisted, on User.passwordHash.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password);
  }

  /** Never throws on a malformed/foreign hash — just reports "doesn't match". */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
