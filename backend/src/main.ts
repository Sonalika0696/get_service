import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/config.service.js';
import { createGlobalValidationPipe } from './common/pipes/validation.pipe.js';
import { RealtimeIoAdapter } from './modules/realtime/realtime-io.adapter.js';

async function bootstrap() {
  // rawBody: true exposes req.rawBody (a Buffer of the exact bytes received)
  // alongside the normal parsed req.body — needed by POST /payments/webhook
  // to verify Razorpay's HMAC signature against the exact bytes it signed,
  // before that payload is trusted or parsed for anything else.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.env.API_CORS_ORIGIN, credentials: true });
  // Mirrors the HTTP CORS policy above for the Socket.IO transport — see
  // RealtimeIoAdapter's doc comment for why this can't just be a static
  // `@WebSocketGateway({ cors: ... })` literal.
  app.useWebSocketAdapter(new RealtimeIoAdapter(app));
  app.useGlobalPipes(createGlobalValidationPipe());
  // /health is excluded so infra probes can hit it without the versioned prefix.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  await app.listen(config.env.API_PORT);
}

await bootstrap();
