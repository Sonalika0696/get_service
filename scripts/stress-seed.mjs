#!/usr/bin/env node
/**
 * DEV-ONLY stress data: creates edge-case records (very long names, many
 * categories, many pricing lines) to probe where the web UI layouts break.
 * Safe to re-run (skips what already exists by name).
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';
let cookie = '';
async function call(p, o = {}) {
  const h = { Accept: 'application/json' };
  if (o.body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (o.idem) h['Idempotency-Key'] = crypto.randomUUID();
  const r = await fetch(BASE + p, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
  const sc = r.headers.getSetCookie?.() ?? [];
  const sid = sc.find((c) => c.startsWith('sid='));
  if (sid) cookie = sid.split(';')[0];
  const t = await r.text();
  const d = t ? (() => { try { return JSON.parse(t); } catch { return t; } })() : null;
  if (!r.ok) throw new Error(`${o.method || 'GET'} ${p} -> ${r.status}: ${JSON.stringify(d)}`);
  return d;
}

async function main() {
  // --- as admin: an absurdly long vendor name + many categories ---
  await call('/auth/dev/login', { method: 'POST', body: { email: 'committee@test-society.local' } });
  const LONG = 'AquaFix Plumbing, Sanitary, Drainage & Waterproofing Solutions Private Limited (Bengaluru South Operational Division)';
  const cats = ['Plumbing', 'Waterproofing', 'Drainage', 'Sanitary fittings', 'Water tank cleaning', 'Borewell servicing', 'Pipe relining', 'Leak detection', 'Bathroom renovation', 'Rainwater harvesting'];
  const existing = await call('/vendors');
  if (!existing.some((v) => v.name === LONG)) {
    const v = await call('/vendors', { method: 'POST', body: { name: LONG, categories: cats, contactEmail: 'ops@aquafix-verylongdomainname-example.co.in', contactPhone: '+91 98200 00000', radiusKm: 12 } });
    console.log('created long-name vendor', v.id, 'cats', v.categories.length);
  } else {
    console.log('long-name vendor already exists');
  }
  // a couple more so the directory has volume
  for (let i = 1; i <= 8; i++) {
    const name = `StressCo Services ${i}`;
    if (!existing.some((v) => v.name === name)) {
      try { await call('/vendors', { method: 'POST', body: { name, categories: ['Electrical', 'AMC'], contactPhone: '+91 90000 000' + String(i).padStart(2, '0'), radiusKm: 5 } }); } catch (e) { console.log('  !', name, e.message); }
    }
  }
  console.log('vendors now:', (await call('/vendors')).length);

  // --- as vendor: a card with a long category + many lines + long labels ---
  cookie = '';
  await call('/auth/dev/login', { method: 'POST', body: { email: 'vendor@coolbreeze.local' } });
  const mine = await call('/pricing-cards/mine');
  const CAT = 'Comprehensive annual maintenance contract (AMC)';
  let card = mine.find((c) => c.category === CAT);
  if (!card) {
    card = await call('/pricing-cards', { method: 'POST', body: { category: CAT, gstRatePct: 18, effectiveFrom: new Date().toISOString() } });
    console.log('created stress card', card.id);
  }
  if (card.status === 'DRAFT') {
    const bases = ['PER_VISIT', 'PER_HOUR', 'PER_UNIT', 'PERCENTAGE'];
    for (let i = card.lines.length; i < 14; i++) {
      await call(`/pricing-cards/${card.id}/lines`, { method: 'POST', body: {
        label: `Line item ${i + 1}: extended service description that runs long to test wrapping and truncation behaviour`,
        basis: bases[i % bases.length], rate: 100 + i * 55, minimum: i % 3 === 0 ? 500 : undefined,
        conditions: 'Applicable during standard working hours only; surcharge on holidays and after 8pm as per contract terms.',
      } });
    }
    const updated = await call(`/pricing-cards/${card.id}`);
    console.log('stress card lines:', updated.lines.length, 'status', updated.status);
  } else {
    console.log('stress card already published with', card.lines.length, 'lines');
  }

  // many categories on the vendor profile
  const prof = await call('/vendors/me/profile');
  for (const c of ['Plumbing', 'Electrical', 'Painting', 'Carpentry', 'Deep cleaning', 'Pest control']) {
    if (!prof.categories.includes(c)) { try { await call('/vendors/me/categories', { method: 'POST', body: { category: c } }); } catch (e) { console.log('  ! cat', c, e.message); } }
  }
  console.log('vendor categories now:', (await call('/vendors/me/profile')).categories.length);
  console.log('\nStress data ready.');
}
main().catch((e) => { console.error('stress-seed failed:', e.message); process.exit(1); });
