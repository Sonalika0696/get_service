'use client';

/**
 * Client-side identity *hint* used only to render the shell (name, role,
 * which portal). The real authority is the httpOnly session cookie the
 * backend sets; any protected request still 401s if that cookie is gone,
 * at which point we clear this hint and bounce to /login.
 *
 * BACKEND GAP: there is no single `GET /auth/session` returning the current
 * principal across RESIDENT / VENDOR / OPERATOR. Once that exists, this hint
 * becomes a cache primed from it rather than the source of the shell state.
 */

export type Portal = 'admin' | 'vendor';

export interface IdentityHint {
  portal: Portal;
  name: string;
  email: string;
  /** RESIDENT (committee/treasurer) | OPERATOR | VENDOR */
  principalKind: string;
  roleLabel: string;
  societyId?: string;
}

import type { SessionResponse } from './types';

const KEY = 'gatex.identity';

export function roleLabelFromKinds(_kinds: string[]): string {
  // Roles are merged into a single "Administrator" in the UI.
  return 'Administrator';
}

/** Derive the shell identity hint from the authoritative /auth/session echo. */
export function identityFromSession(s: SessionResponse): IdentityHint {
  const portal: Portal = s.principalKind === 'VENDOR' ? 'vendor' : 'admin';
  const roleLabel =
    s.principalKind === 'OPERATOR'
      ? 'Platform operator'
      : s.principalKind === 'VENDOR'
        ? 'Vendor'
        : roleLabelFromKinds(s.roleKinds ?? []);
  return { portal, name: s.name, email: s.email, principalKind: s.principalKind, roleLabel, societyId: s.societyId };
}

export function setIdentity(hint: IdentityHint) {
  try {
    localStorage.setItem(KEY, JSON.stringify(hint));
  } catch {
    /* private mode / storage disabled — shell falls back to generic labels */
  }
}

export function getIdentity(): IdentityHint | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as IdentityHint) : null;
  } catch {
    return null;
  }
}

export function clearIdentity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
