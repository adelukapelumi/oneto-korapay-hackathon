import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { CashoutModule } from "../cashout/cashout.module";
import { RecoveryModule } from "../recovery/recovery.module";

@Module({
  imports: [PrismaModule, AuthModule, CashoutModule, RecoveryModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
