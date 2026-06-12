import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RecoveryBalanceService } from "./recovery-balance.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RecoveryBalanceService],
  exports: [RecoveryBalanceService],
})
export class BalanceModule {}
