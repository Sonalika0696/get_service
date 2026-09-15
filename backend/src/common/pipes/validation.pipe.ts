import { ValidationPipe } from '@nestjs/common';

/**
 * The one validation policy every DTO in this app is checked against.
 * `whitelist` + `forbidNonWhitelisted` reject any field a DTO didn't declare
 * instead of silently dropping or accepting it — important once payment and
 * ledger payloads exist.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}
