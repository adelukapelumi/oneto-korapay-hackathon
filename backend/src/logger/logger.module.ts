import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

const isDevelopment = process.env.NODE_ENV === 'development';
const canUsePrettyTransport = (() => {
  if (!isDevelopment) {
    return false;
  }

  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
})();

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: isDevelopment ? 'debug' : 'info',
        transport: canUsePrettyTransport ? { target: 'pino-pretty' } : undefined,
      },
    }),
  ],
})
export class LoggerModule {}
