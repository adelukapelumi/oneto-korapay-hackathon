import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envSchema } from './env.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const parsed = envSchema.safeParse(config);
        if (!parsed.success) {
          console.error('Invalid environment variables:', parsed.error.format());
          throw new Error('Invalid environment variables');
        }
        return parsed.data;
      },
    }),
  ],
})
export class ConfigModule {}
