import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpStoreService } from "./otp-store.service";
import { JwtWrapperService } from "./jwt.service";
import { OtpChannelModule } from "../otp-channel/otp-channel.module";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "15m" },
      }),
    }),
    OtpChannelModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpStoreService, JwtWrapperService, JwtAuthGuard],
  exports: [AuthService, JwtWrapperService, JwtAuthGuard],
})
export class AuthModule { }