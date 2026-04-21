import { Module } from '@nestjs/common';
import { TopupController } from './topup.controller';

@Module({
  controllers: [TopupController],
})
export class TopupModule {}
