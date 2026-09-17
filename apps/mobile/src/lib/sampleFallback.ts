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
  isEmpty: (data: T) => boolean,
  sample: T,
): SampleFallbackResult<T> {
  const settled = query.isSuccess || query.isError;
  const usable = query.isSuccess && query.data !== undefined && !isEmpty(query.data);
  const isSample = settled && !usable;

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
