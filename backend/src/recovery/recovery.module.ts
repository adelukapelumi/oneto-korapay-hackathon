import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RecoveryController } from "./recovery.controller";
import { RecoveryService } from "./recovery.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RecoveryController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
