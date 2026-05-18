import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { REDIS_CLIENT, RedisClient } from "./redis.tokens";

@Injectable()
class RedisLifecycleService implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redisClient !== null) {
      await this.redisClient.quit();
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<RedisClient> => {
        const otpBackend = config.get<string>("OTP_STORE_BACKEND") ?? "memory";
        const throttlerBackend = config.get<string>("THROTTLER_STORE_BACKEND") ?? "memory";
        const shouldUseRedis = otpBackend === "redis" || throttlerBackend === "redis";

        if (!shouldUseRedis) {
          return null;
        }

        const redisUrl = config.get<string>("REDIS_URL");
        if (!redisUrl) {
          throw new Error("REDIS_URL is required when Redis storage is enabled");
        }

        const keyPrefix = config.get<string>("REDIS_KEY_PREFIX") ?? "oneto:dev";
        const client = new Redis(redisUrl, {
          keyPrefix: `${keyPrefix}:`,
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });

        try {
          await client.connect();
          await client.ping();
        } catch (error) {
          client.disconnect();
          throw new Error(
            `Failed to connect to Redis during startup: ${(error as Error).message}`,
          );
        }

        return client;
      },
    },
    RedisLifecycleService,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
