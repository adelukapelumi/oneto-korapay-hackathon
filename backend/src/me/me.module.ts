import { Module } from "@nestjs/common";
import { MeController } from "./me.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { BalanceModule } from "../balance/balance.module";

@Module({
  imports: [PrismaModule, AuthModule, BalanceModule],
  controllers: [MeController],
})
export class MeModule { }
