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
