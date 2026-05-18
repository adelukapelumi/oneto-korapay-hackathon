import './instrument';
import helmet from 'helmet';


import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { buildAllowedCorsOrigins } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Required behind Railway/reverse proxies so throttling keys on real client IP.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useLogger(app.get(Logger));
  app.use(helmet());


  const configService = app.get(ConfigService);
  const port = configService.get<string>('PORT') || 3000;
  const adminWebOriginsCsv = configService.get<string>('ADMIN_WEB_ORIGINS');
  const allowedOrigins = new Set(buildAllowedCorsOrigins(adminWebOriginsCsv));

  // Browser CORS is restricted to explicit allowlisted admin-web origins.
  // Requests without Origin (mobile apps, Postman, server-to-server) remain allowed.
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Oneto-Admin-CSRF'],
    optionsSuccessStatus: 204,
  });

  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
