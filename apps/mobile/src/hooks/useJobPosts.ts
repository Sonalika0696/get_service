import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobBlogPost, CreateJobPostBody } from '@sft/api-client';
import { api } from '../lib/api';

/**
 * The community feed. Backed by GET /jobs — the shipped job-blog module,
 * which is the closest surface the backend has to a notice board today.
 * Posts are ACTIVE + unexpired + (SEEKING or company-email verified).
 */
export function useJobPosts() {
  return useQuery({
    queryKey: ['job-posts'],
    queryFn: () => api<JobBlogPost[]>('/jobs'),
    staleTime: 60_000,
  });
}

export function useJobPost(id: string | undefined) {
  return useQuery({
    queryKey: ['job-post', id],
    queryFn: () => api<JobBlogPost>(`/jobs/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateJobPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateJobPostBody) =>
      api<JobBlogPost>('/jobs', { method: 'POST', body }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['job-posts'] });
    },
  });
}
