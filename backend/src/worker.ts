import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/config.service.js';
import { BillingCycleService } from './modules/electricity/billing/billing-cycle.service.js';
import { startBillingWorker } from './modules/electricity/billing/billing.worker.js';

/**
 * Phase 10 — out-of-process worker entrypoint for `BILLING_WORKER_INLINE=false`
 * deployments: `node dist/worker.js`. Boots a Nest application CONTEXT (no
 * HTTP listener, no controllers wired up) purely to resolve
 * BillingCycleService and everything it depends on via the SAME AppModule
 * the API process uses, then starts the BullMQ `Worker` listening on the
 * 'billing' queue (billing.queue.ts / billing.worker.ts).
 *
 * In the default `BILLING_WORKER_INLINE=true` configuration (dev/test and
 * the e2e suite), this file is never run — every billing-cycle stage
 * executes inline inside the API request via
 * BillingCycleService.runStagesInline directly.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule);
  const config = app.get(AppConfigService);
  const billingCycleService = app.get(BillingCycleService);

  const worker = startBillingWorker(config, billingCycleService);
  logger.log(`Billing worker listening on the 'billing' queue (${config.env.REDIS_URL})`);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — closing billing worker`);
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

await bootstrap();
