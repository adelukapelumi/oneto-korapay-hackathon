import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RecoveryController } from "./recovery.controller";
import { RecoveryEmailService } from "./recovery-email.service";
import { RecoveryService } from "./recovery.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RecoveryController],
  providers: [RecoveryService, RecoveryEmailService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
