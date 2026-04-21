import { IsString } from 'class-validator';

// Thin wrapper for NestJS DI / Swagger. Actual validation is done by Zod.
export class VerifyOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  code!: string;
}
