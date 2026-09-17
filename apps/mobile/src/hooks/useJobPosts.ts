import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobBlogPost, CreateJobPostBody } from '@sft/api-client';
import { api } from '../lib/api';

/**
 * The community feed. Backed by GET /jobs — the shipped job-blog module,
 * which is the closest surface the backend has to a notice board today.
 * Posts are ACTIVE + unexpired + (SEEKING or company-email verified).
 *
 * The Community tab only shows HIRING posts (the SEEKING concept is
 * retired on the client) — filtered here rather than on the backend, which
 * still serves both kinds.
 */
export function useJobPosts() {
  return useQuery({
    queryKey: ['job-posts'],
    queryFn: async () => {
      const posts = await api<JobBlogPost[]>('/jobs');
      return posts.filter((post) => post.kind === 'HIRING');
    },
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
