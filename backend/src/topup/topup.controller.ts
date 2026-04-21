import { Controller, Post, NotImplementedException } from '@nestjs/common';

@Controller('topup')
export class TopupController {
  @Post('korapay/initiate')
  async initiate(): Promise<never> {
    throw new NotImplementedException('Korapay initiate not implemented yet');
  }

  @Post('korapay/webhook')
  async webhook(): Promise<never> {
    throw new NotImplementedException('Korapay webhook not implemented yet');
  }
}
