import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { CashoutModule } from "../cashout/cashout.module";

@Module({
  imports: [PrismaModule, AuthModule, CashoutModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

