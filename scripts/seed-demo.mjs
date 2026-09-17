#!/usr/bin/env node
/**
 * Demo-data seeder for the GateX web console. Signs in as the seeded admin
 * via the dev-login endpoint and creates realistic data through the app's
 * OWN public endpoints (no direct DB writes): service providers, fund
 * balances (ledger adjustments), group offers, and resident requests.
 *
 * Usage: node scripts/seed-demo.mjs   (backend must be running on :4000)
 */

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
const ADMIN_EMAIL = 'committee@test-society.local';

let cookie = '';

async function call(path, { method = 'GET', body, idempotency } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (idempotency) headers['Idempotency-Key'] = idempotency;

  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  const sid = setCookie.find((c) => c.startsWith('sid='));
  if (sid) cookie = sid.split(';')[0];

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function futureIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

const VENDORS = [
  { name: 'CoolBreeze AC Services', categories: ['AC service', 'AMC'], contactEmail: 'ops@coolbreeze.in', contactPhone: '+91 98200 11223', radiusKm: 8, gstin: '27AABCC1234D1Z5' },
  { name: 'AquaFix Plumbing', categories: ['Plumbing'], contactEmail: 'help@aquafix.in', contactPhone: '+91 98200 44556', radiusKm: 6, gstin: '27AAFCA9988E1Z2' },
  { name: 'BrightSpark Electricals', categories: ['Electrical'], contactEmail: 'team@brightspark.in', contactPhone: '+91 98200 77889', radiusKm: 10 },
  { name: 'GreenLeaf Deep Cleaning', categories: ['Deep cleaning', 'Pest control'], contactEmail: 'book@greenleaf.in', contactPhone: '+91 98200 33445', radiusKm: 12, gstin: '27AAGCG5566F1Z8' },
  { name: 'Sharma Tanker Supply', categories: ['Tanker supply'], contactEmail: 'orders@sharmatanker.in', contactPhone: '+91 98200 66778', radiusKm: 15 },
  { name: 'FreshMart Grocery', categories: ['Groceries'], contactEmail: 'sales@freshmart.in', contactPhone: '+91 98200 22110', radiusKm: 5 },
];

const ADJUSTMENTS = [
  { debitKind: 'EXTERNAL', creditKind: 'SOCIETY_MASTER', amount: 985000, reasonCode: 'Maintenance collections Q1' },
  { debitKind: 'EXTERNAL', creditKind: 'BULK_BUY', amount: 120000, reasonCode: 'Procurement escrow top-up' },
  { debitKind: 'SOCIETY_MASTER', creditKind: 'VENDOR', amount: 45000, reasonCode: 'Vendor settlement staged' },
  { debitKind: 'SOCIETY_MASTER', creditKind: 'RETENTION', amount: 18000, reasonCode: 'Defect-liability retention' },
  { debitKind: 'SOCIETY_MASTER', creditKind: 'DISPUTE', amount: 6000, reasonCode: 'Disputed charge hold' },
];

async function main() {
  console.log('Signing in as admin...');
  await call('/auth/dev/login', { method: 'POST', body: { email: ADMIN_EMAIL } });
  if (!cookie) throw new Error('No session cookie returned from dev-login');

  console.log('Creating service providers...');
  const vendorIds = [];
  for (const v of VENDORS) {
    try {
      const created = await call('/vendors', { method: 'POST', body: v });
      vendorIds.push(created.id);
      console.log(`  + ${v.name}`);
    } catch (e) {
      console.log(`  ! ${v.name}: ${e.message}`);
    }
  }

  console.log('Verifying GSTINs (attesting where active)...');
  for (const id of vendorIds) {
    try {
      const r = await call(`/vendors/${id}/approve`, { method: 'POST' });
      console.log(`  ~ ${r.name}: ${r.note}`);
    } catch (e) {
      console.log(`  ! approve ${id}: ${e.message}`);
    }
  }

  console.log('Posting fund balances (ledger adjustments)...');
  for (const a of ADJUSTMENTS) {
    try {
      await call('/ledger/adjustments', { method: 'POST', body: a, idempotency: crypto.randomUUID() });
      console.log(`  + ${a.creditKind} <- ${a.debitKind}  ₹${a.amount.toLocaleString('en-IN')}`);
    } catch (e) {
      console.log(`  ! ${a.reasonCode}: ${e.message}`);
    }
  }

  if (vendorIds.length) {
    console.log('Posting group offers...');
    const offers = [
      { vendorId: vendorIds[0], category: 'AC service', title: 'Pre-summer AC servicing drive', description: 'Coil clean, gas top-up and filter change for all participating flats.', unitPrice: 1200, discountLadder: [{ minN: 10, pct: 10 }, { minN: 20, pct: 15 }], deadline: futureIso(7) },
      { vendorId: vendorIds[3] ?? vendorIds[0], category: 'Deep cleaning', title: 'Festival deep-clean package', description: 'Full-home deep clean ahead of the festival season.', unitPrice: 2500, discountLadder: [{ minN: 8, pct: 12 }], deadline: futureIso(12) },
      { vendorId: vendorIds[4] ?? vendorIds[0], category: 'Tanker supply', title: 'Summer tanker contract', description: 'Guaranteed tanker slots through the dry months.', unitPrice: 900, discountLadder: [{ minN: 15, pct: 8 }, { minN: 30, pct: 14 }], deadline: futureIso(20) },
    ];
    for (const o of offers) {
      try {
        await call('/offers', { method: 'POST', body: o });
        console.log(`  + ${o.title}`);
      } catch (e) {
        console.log(`  ! ${o.title}: ${e.message}`);
      }
    }

    console.log('Opening resident requests...');
    const polls = [
      { taggedVendorId: vendorIds[1] ?? vendorIds[0], category: 'Plumbing', title: 'Recurring bathroom leaks in B block', proposedMinimum: 4, closesAt: futureIso(6) },
      { taggedVendorId: vendorIds[2] ?? vendorIds[0], category: 'Electrical', title: 'Common-area wiring check', proposedMinimum: 3, closesAt: futureIso(9) },
    ];
    for (const p of polls) {
      try {
        await call('/bulk-buy/polls', { method: 'POST', body: p });
        console.log(`  + ${p.title}`);
      } catch (e) {
        console.log(`  ! ${p.title}: ${e.message}`);
      }
    }
  }

  console.log('\nDone. Reload the console to see the data.');
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
