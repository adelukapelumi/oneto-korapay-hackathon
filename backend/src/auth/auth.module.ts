import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { InMemoryOtpStoreService } from "./in-memory-otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { OtpChannelModule } from "../otp-channel/otp-channel.module";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { KeysController } from "./keys.controller";
import { MerchantAuthController } from "./merchant-auth.controller";
import { MerchantAuthService } from "./merchant-auth.service";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminCookieSessionGuard } from "./admin-cookie-session.guard";
import { AdminCsrfGuard } from "./admin-csrf.guard";
import { OTP_STORE } from "./otp-store.service";
import { RedisOtpStoreService } from "./redis-otp-store.service";
import { RedisModule } from "../redis/redis.module";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET"),
        // Keep access tokens short-lived. Max value is enforced by env schema.
        signOptions: {
          expiresIn: config.get<number>("JWT_ACCESS_TTL_SECONDS") ?? 3600,
        },
      }),
    }),
    OtpChannelModule,
    PrismaModule,
    RedisModule,
  ],
  controllers: [AuthController, KeysController, MerchantAuthController],
  providers: [
    AuthService,
    InMemoryOtpStoreService,
    RedisOtpStoreService,
    {
      provide: OTP_STORE,
      inject: [ConfigService, InMemoryOtpStoreService, RedisOtpStoreService],
      useFactory: (
        config: ConfigService,
        inMemoryOtpStore: InMemoryOtpStoreService,
        redisOtpStore: RedisOtpStoreService,
      ) => {
        return config.get<string>("OTP_STORE_BACKEND") === "redis"
          ? redisOtpStore
          : inMemoryOtpStore;
      },
    },
    JwtWrapperService,
    JwtAuthGuard,
    MerchantAuthService,
    AdminCookieSessionGuard,
    AdminCsrfGuard,
  ],
  exports: [
    AuthService,
    JwtWrapperService,
    JwtAuthGuard,
    MerchantAuthService,
    AdminCookieSessionGuard,
    AdminCsrfGuard,
  ],
})
export class AuthModule { }
