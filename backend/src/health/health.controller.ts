import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }

  @Get('debug-sentry')
  debugSentry(): never {
    throw new Error('Sentry test error from /health/debug-sentry');
  }
}