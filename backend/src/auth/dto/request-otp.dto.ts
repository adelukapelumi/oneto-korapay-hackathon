import { IsString } from 'class-validator';

// Thin wrapper for NestJS DI / Swagger. Actual validation is done by Zod.
export class RequestOtpDto {
  @IsString()
  phone!: string;
}
