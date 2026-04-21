import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  
  app.useLogger(app.get(Logger));
  
  const configService = app.get(ConfigService);
  const port = configService.get<string>('PORT') || 3000;
  
  app.enableCors();
  
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
