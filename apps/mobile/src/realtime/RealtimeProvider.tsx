import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../auth/AuthProvider';
import { apiOrigin, getAuthToken } from '../lib/api';
import { RealtimeToast, type RealtimeToastState } from '../components/RealtimeToast';

type CommunityUnreadValue = { unread: boolean; markSeen: () => void };

/**
 * Whether a society-event update (`event.*`) has arrived since the user last
 * looked at the Community tab. The provider only ever flips this to `true`;
 * clearing it is the consumer's job (the tab host calls `markSeen()` while
 * Community is the active tab), so a badge never lingers once it's been seen
 * and never shows at all if the user was already looking at the tab when the
 * update landed.
 */
const CommunityUnreadContext = createContext<CommunityUnreadValue>({
  unread: false,
  markSeen: () => undefined,
});

/** Safe even if called outside `RealtimeProvider` — defaults to no badge. */
export function useCommunityUnread(): CommunityUnreadValue {
  return useContext(CommunityUnreadContext);
}

/** Envelope every domain event arrives in, per realtime.gateway.ts. */
type DomainEvent = { type: string; payload: unknown; at: string };

function isDomainEvent(value: unknown): value is DomainEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

type Domain = 'resident-polls' | 'events' | 'bills';

/** type -> (which screens should refetch, what the banner says). */
const EVENT_MESSAGES: Record<string, string> = {
  'service_request.created': 'A neighbour raised a pooled request.',
  'service_request.pooled': 'A request you can join was pooled with others.',
  'service_request.assigned': 'A vendor was assigned to a pooled request.',
  'service_request.confirmed': 'Vendor confirmed a pooled request.',
  'event.created': 'A new society event was posted.',
  'event.fired': 'An event you can join is now confirmed.',
  'event.expired': 'An event closed without enough interest.',
};

const DOMAIN_FALLBACK_MESSAGE: Record<Domain, string> = {
  'resident-polls': 'A pooled request was updated.',
  events: 'An event was updated.',
  bills: 'A bill was updated.',
};

/**
 * Maps an event `type` to the query domain it affects. Matches by prefix
 * (`service_request.`, `event.`, `bill.`) rather than an exact list so a new
 * subtype the backend adds later (e.g. `bill.overdue`) still routes
 * correctly instead of silently doing nothing. An unrecognised prefix is a
 * deliberate no-op — future domains outside this app's current screens.
 */
function domainOf(type: string): Domain | null {
  if (type.startsWith('service_request.')) return 'resident-polls';
  if (type.startsWith('event.')) return 'events';
  if (type.startsWith('bill.')) return 'bills';
  return null;
}

function invalidateForDomain(client: QueryClient, domain: Domain): void {
  switch (domain) {
    case 'resident-polls':
      client.invalidateQueries({ queryKey: ['resident-polls'] });
      client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'resident-poll' });
      break;
    case 'events':
      client.invalidateQueries({ queryKey: ['events'] });
      client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'event' });
      break;
    case 'bills':
      // No dedicated bills query key ships yet (useBillsHub composes from
      // resident-polls — see its TODO(phase 9 backend)); this targets the
      // eventual `/me/bills` cache key plus in-flight payment polling so it
      // needs no change when that endpoint lands.
      client.invalidateQueries({ queryKey: ['bills'] });
      client.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'payment' });
      break;
  }
}

const TOAST_DURATION_MS = 4000;

/**
 * Connects to the backend's realtime gateway (backend/src/modules/realtime)
 * while signed in, invalidates the TanStack Query keys a domain event
 * affects so the relevant list refetches, and surfaces a short-lived in-app
 * banner. Best-effort by design: a socket that never connects (backend
 * down, bad host resolution, no token) just means no live updates — it must
 * never crash or block the app.
 *
 * Mount once, inside both AuthProvider (reads sign-in state) and the query
 * provider (invalidates its cache) — see app/_layout.tsx.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<RealtimeToastState | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [communityUnread, setCommunityUnread] = useState(false);
  const markCommunitySeen = useCallback(() => setCommunityUnread(false), []);

  const showToast = useCallback((message: string) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setToast({ id: Date.now(), message });
    dismissTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!isSignedIn) return;

    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      let token: string | null = null;
      try {
        token = await getAuthToken();
      } catch {
        // Token lookup failed (keychain unavailable, etc.) — skip realtime.
      }
      if (!token || cancelled) return;

      try {
        socket = io(apiOrigin, {
          auth: { token },
          transports: ['websocket'],
        });

        socket.on('domain-event', (raw: unknown) => {
          if (!isDomainEvent(raw)) return;
          const domain = domainOf(raw.type);
          if (!domain) return; // unrecognised type: no-op, never crash
          invalidateForDomain(queryClient, domain);
          showToast(EVENT_MESSAGES[raw.type] ?? DOMAIN_FALLBACK_MESSAGE[domain]);
          // Society-event updates surface as a Community tab badge too. The
          // provider only sets it; it's cleared by whoever is watching the
          // active tab (see useCommunityUnread's consumer), so an update
          // that lands while Community is already open never shows a badge.
          if (raw.type.startsWith('event.')) setCommunityUnread(true);
        });

        // Connection/auth failures are expected in dev (backend down, no
        // token yet) — swallow them, socket.io's own backoff retries.
        socket.on('connect_error', () => undefined);
        socket.on('error', () => undefined);
      } catch {
        // Never let a realtime setup failure take down the app.
        socket = null;
      }
    })();

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
    // Reconnects the socket if it disconnected while signed in; socket.io's
    // own reconnection handles transient drops, so this effect only needs
    // to re-run on sign-in/sign-out.
  }, [isSignedIn, queryClient, showToast]);

  return (
    <CommunityUnreadContext.Provider value={{ unread: communityUnread, markSeen: markCommunitySeen }}>
      {children}
      <RealtimeToast toast={toast} />
    </CommunityUnreadContext.Provider>
  );
}
