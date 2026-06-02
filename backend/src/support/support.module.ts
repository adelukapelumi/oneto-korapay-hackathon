import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { SupportController } from "./support.controller";
import { SupportEmailService } from "./support-email.service";
import { SupportService } from "./support.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SupportController],
  providers: [SupportService, SupportEmailService],
})
export class SupportModule {}
