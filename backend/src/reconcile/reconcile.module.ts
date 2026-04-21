import { Module } from '@nestjs/common';
import { ReconcileController } from './reconcile.controller';

@Module({
  controllers: [ReconcileController],
})
export class ReconcileModule {}
