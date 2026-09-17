/**
 * Shared "degrade to sample data" behaviour for the resident-facing hooks
 * (useHome, useBillsHub, useResidentPolls, useEvents, useJobPosts). The
 * shared dev backend can 401 with "session expired or invalid" (a wiped DB)
 * or legitimately return an empty payload — either way the screen should
 * still look presentable rather than showing an error the resident didn't
 * cause. Once the underlying query SETTLES (succeeds or errors) with
 * nothing usable, callers get the curated sample data instead, tagged
 * `isSample: true` so the section can caption it and skip the error card.
 *
 * While the query is still pending, everything passes through unchanged —
 * sample data only ever replaces a *settled* result, never a loading one.
 */

type MinimalQueryResult<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
};

export type SampleFallbackResult<T> = {
  /** Undefined only while the query is still pending — same as a plain
   * react-query result. Once settled, this is always defined: either the
   * real data or the sample. */
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  /** True when `data` is the curated sample, not a real backend response. */
  isSample: boolean;
};

export function withSampleFallback<T>(
  query: MinimalQueryResult<T>,
  _isEmpty: (data: T) => boolean,
  sample: T,
): SampleFallbackResult<T> {
  // Only stand in for a genuine FAILURE: an error, or a settled success that
  // yielded no data at all. A legitimately-empty result from a healthy,
  // seeded backend is REAL data and must render as an honest empty state
  // (₹0 due, "nothing raised yet"), not sample content — otherwise the app
  // would disagree with itself (e.g. real ₹0 on Home vs sample bills). The
  // fallback is a safety net for an unreachable/unshipped endpoint, not a
  // substitute for "nothing to show". (`_isEmpty` retained for signature
  // stability; empty lists are intentionally treated as real.)
  const isSample = query.isError || (query.isSuccess && query.data === undefined);

  return {
    data: isSample ? sample : query.data,
    isLoading: query.isLoading,
    isError: isSample ? false : query.isError,
    isSuccess: isSample ? true : query.isSuccess,
    error: isSample ? null : query.error,
    refetch: query.refetch,
    isSample,
  };
}
