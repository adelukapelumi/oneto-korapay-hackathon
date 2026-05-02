import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpStoreService } from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { OtpChannelModule } from "../otp-channel/otp-channel.module";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { KeysController } from "./keys.controller";
import { MerchantAuthController } from "./merchant-auth.controller";
import { MerchantAuthService } from "./merchant-auth.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "30d" },
      }),
    }),
    OtpChannelModule,
    PrismaModule,
  ],
  controllers: [AuthController, KeysController, MerchantAuthController],
  providers: [AuthService, OtpStoreService, JwtWrapperService, JwtAuthGuard, MerchantAuthService],
  exports: [AuthService, JwtWrapperService, JwtAuthGuard, MerchantAuthService],
})
export class AuthModule { }