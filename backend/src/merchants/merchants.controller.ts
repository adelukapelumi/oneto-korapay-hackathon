import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MerchantsService } from "./merchants.service";

@Controller("merchants")
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get("list")
  @UseGuards(JwtAuthGuard)
  async list() {
    const merchants = await this.merchantsService.listActiveApprovedMerchants();
    return { merchants };
  }
}

