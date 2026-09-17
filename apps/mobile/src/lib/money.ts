/**
 * Money helpers. Every amount that crosses a wire in this codebase is stored
 * in MINOR units (paise) as an integer, formatted only at the display edge.
 * Values are Indian-locale by default because that's who this app serves;
 * pass an explicit locale to `formatMinor` for anything else.
 */

export function formatMinor(
  minor: number,
  currency = 'INR',
  { showDecimals = true, locale = 'en-IN' }: { showDecimals?: boolean; locale?: string } = {},
): string {
  const value = minor / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(value);
}

/**
 * Backend PaymentsService.createOrder takes major units (rupees). This is
 * the one boundary in the mobile app that speaks major, kept in a named
 * helper so the conversion is auditable.
 */
export function minorToMajor(minor: number): number {
  return Math.round(minor) / 100;
}

/**
 * The other boundary: `GET /me/home` and `GET /me/bills` serialise money as
 * DECIMAL rupee strings in MAJOR units (Prisma Decimal on the wire, e.g.
 * "12450.00"). Converts to the integer MINOR units every display component
 * expects. Guards against a malformed/non-numeric string so a bad payload
 * degrades to 0 rather than propagating NaN into a render.
 */
export function majorStringToMinor(major: string): number {
  const value = Number(major);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
