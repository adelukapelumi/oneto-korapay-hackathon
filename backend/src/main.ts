import './instrument';
import helmet from 'helmet';


import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { buildAllowedCorsOrigins } from './common/cors';
import type { NextFunction, Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const expressApp = app.getHttpAdapter().getInstance();
  // Required behind Railway/reverse proxies so throttling keys on real client IP.
  expressApp.set('trust proxy', 1);
  expressApp.disable('etag');

  app.useLogger(app.get(Logger));
  app.use(helmet());

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });


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
