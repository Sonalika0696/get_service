import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/config.service.js';
import { createGlobalValidationPipe } from './common/pipes/validation.pipe.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.env.API_CORS_ORIGIN, credentials: true });
  app.useGlobalPipes(createGlobalValidationPipe());
  // /health is excluded so infra probes can hit it without the versioned prefix.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  await app.listen(config.env.API_PORT);
}

await bootstrap();
