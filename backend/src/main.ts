import './instrument';
import helmet from 'helmet';


import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

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

  // CORS disabled for mobile-only pilot - mobile apps don't use CORS,
  // and no browser clients exist yet. Re-enable with an origin whitelist
  // when/if we build a web admin dashboard.
  app.enableCors({ origin: false });

  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
