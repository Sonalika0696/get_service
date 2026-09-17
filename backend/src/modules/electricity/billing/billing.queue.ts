import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../../config/config.service.js';

export const BILLING_QUEUE_NAME = 'billing';

export interface BillingRunJobData {
  societyId: string;
  cycleId: string;
}

/**
 * Phase 10 — the billing-cycle pipeline's out-of-process job queue
 * (BILLING_WORKER_INLINE=false). The ioredis connection and the BullMQ
 * `Queue` are both created LAZILY, on the first `enqueueRun` call — never in
 * the constructor — so simply importing BillingModule (and therefore
 * AppModule, and therefore every e2e spec that boots the whole app) can
 * never force a Redis connection. `BillingCycleService.run()` only ever
 * calls `enqueueRun` when `BILLING_WORKER_INLINE` is explicitly false, which
 * is never the case in dev/test (see env.schema.ts's doc comment on that
 * flag), so this class's Redis connection is opened in practice only by a
 * deployment that actually runs the separate `node dist/worker.js` process.
 */
@Injectable()
export class BillingQueue implements OnModuleDestroy {
  private readonly logger = new Logger(BillingQueue.name);
  private queue: Queue<BillingRunJobData> | null = null;
  private connection: Redis | null = null;

  constructor(private readonly config: AppConfigService) {}

  private getQueue(): Queue<BillingRunJobData> {
    if (!this.queue) {
      this.connection = new Redis(this.config.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
      this.queue = new Queue<BillingRunJobData>(BILLING_QUEUE_NAME, { connection: this.connection });
    }
    return this.queue;
  }

  /**
   * Enqueues a run for `cycleId`. `jobId` is the cycle id itself, so BullMQ
   * de-dupes concurrent enqueue calls for the same cycle (e.g. a treasurer
   * double-clicking "run") into a single queued/active job rather than
   * running the pipeline twice in parallel — on top of, not instead of, the
   * per-stage advisory lock (BILLING_CYCLE_LOCK_NAMESPACE) BillingCycleService
   * itself takes.
   */
  async enqueueRun(data: BillingRunJobData): Promise<void> {
    await this.getQueue().add('run', data, {
      jobId: `billing-run:${data.cycleId}`,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue?.close();
      await this.connection?.quit();
    } catch (error) {
      this.logger.warn(`Error closing billing queue connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
