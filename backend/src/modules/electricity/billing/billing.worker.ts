import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../../config/config.service.js';
import { BILLING_QUEUE_NAME, type BillingRunJobData } from './billing.queue.js';
import { BillingCycleService } from './billing-cycle.service.js';

/**
 * Phase 10 — starts the BullMQ `Worker` that processes the 'billing' queue:
 * the out-of-process counterpart to `BillingCycleService.run()`'s inline
 * path, used only when `BILLING_WORKER_INLINE=false`. This module opens its
 * OWN ioredis connection (separate from BillingQueue's producer-side
 * connection) — only `src/worker.ts` ever calls this function, so the main
 * API process never opens it.
 */
export function startBillingWorker(config: AppConfigService, billingCycleService: BillingCycleService): Worker<BillingRunJobData> {
  const logger = new Logger('BillingWorker');
  const connection = new Redis(config.env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker<BillingRunJobData>(
    BILLING_QUEUE_NAME,
    async (job: Job<BillingRunJobData>) => {
      logger.log(`Running billing cycle ${job.data.cycleId} (society ${job.data.societyId})`);
      // Same method the inline path calls — see BillingCycleService.run's
      // doc comment: pipeline behaviour must be identical in both modes.
      await billingCycleService.runStagesInline(job.data.societyId, job.data.cycleId);
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    logger.error(`Billing cycle run failed for job ${job?.id ?? '(unknown)'}: ${err.message}`, err.stack);
  });

  return worker;
}
