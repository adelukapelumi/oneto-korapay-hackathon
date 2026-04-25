import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// Process-level safety net so a transient WebSocket close
// from Neon's serverless driver does not crash the entire app.
// These listeners are attached once at module load.
process.on('uncaughtException', (err: Error) => {
  if (err.message?.includes('Connection terminated') || err.message?.includes('WebSocket')) {
    console.warn('[PrismaService] Caught Neon connection error (will reconnect):', err.message);
    return;
  }
  // Re-throw non-Neon errors so we don't silently hide bugs.
  throw err;
});

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly serviceLogger = new Logger(PrismaService.name);
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }

    const pool = new Pool({ connectionString });

    pool.on('error', (err: Error) => {
      console.warn('[PrismaService] Pool error (will reconnect):', err.message);
    });

    pool.on('connect', (client: { on: (event: string, listener: (err: Error) => void) => void }) => {
      client.on('error', (err: Error) => {
        console.warn('[PrismaService] Client error (will reconnect):', err.message);
      });
    });

    const adapter = new PrismaNeon(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    this.serviceLogger.log('Prisma connected via Neon serverless driver');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}