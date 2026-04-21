import { Controller, Post, NotImplementedException } from '@nestjs/common';

@Controller('reconcile')
export class ReconcileController {
  @Post()
  async reconcile(): Promise<never> {
    throw new NotImplementedException('Reconcile endpoint not implemented yet');
  }

  @Post('status')
  async status(): Promise<never> {
    throw new NotImplementedException('Reconcile status endpoint not implemented yet');
  }
}
