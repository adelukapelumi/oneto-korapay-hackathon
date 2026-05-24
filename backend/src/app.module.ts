import { MeModule } from "./me/me.module";
import { CashoutModule } from "./cashout/cashout.module";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { ConfigModule } from "./config/config.module";
import { LoggerModule } from "./logger/logger.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ReconcileModule } from "./reconcile/reconcile.module";
import { TopupModule } from "./topup/topup.module";
import { KorapayModule } from "./korapay/korapay.module";
import { HealthModule } from "./health/health.module";
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';
import { MerchantsModule } from "./merchants/merchants.module";
import { AdminModule } from "./admin/admin.module";
import { RedisModule } from "./redis/redis.module";
import { REDIS_CLIENT } from "./redis/redis.tokens";
import { RecoveryModule } from "./recovery/recovery.module";

@Module({
  imports: [
    // Global IP-keyed rate limit. Defense-in-depth layer that catches
    // floods against any endpoint. Per-target limits live in OtpStoreService
    // and are more precise; this guard is the coarse safety net.
    //
    // Config: 100 requests per minute per IP. Tune down before pilot launch
    // based on expected legitimate traffic patterns.
    SentryModule.forRoot(),
    ConfigModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redisClient: Redis | null) => {
        const throttlerBackend = config.get<string>("THROTTLER_STORE_BACKEND") ?? "memory";

        if (throttlerBackend === "redis" && redisClient === null) {
          throw new Error("Redis throttler storage is enabled without an initialized Redis client");
        }

        return {
          throttlers: [
            {
              ttl: 60_000,
              limit: 100,
            },
          ],
          storage:
            throttlerBackend === "redis" && redisClient !== null
              ? new ThrottlerStorageRedisService(redisClient)
              : undefined,
        };
      },
    }),
    LoggerModule,
    PrismaModule,
    AuthModule,
    ReconcileModule,
    TopupModule,
    KorapayModule,
    MerchantsModule,
    MeModule,
    CashoutModule,
    RecoveryModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { } 
