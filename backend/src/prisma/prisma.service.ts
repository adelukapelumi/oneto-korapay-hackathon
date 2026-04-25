import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Required for Neon's WebSocket-based serverless driver in Node.js.
neonConfig.webSocketConstructor = ws;

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

    // Swallow connection-error events so a transient WebSocket close
    // doesn't crash the entire Node process. Prisma will reconnect
    // on the next query automatically.
    pool.on('error', (err: Error) => {
      // Logger is not yet available in constructor — use console here.
      console.warn('[PrismaService] Pool error (will reconnect):', err.message);
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