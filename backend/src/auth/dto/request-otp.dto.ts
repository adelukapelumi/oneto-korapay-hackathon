import { IsEmail } from 'class-validator';

// Thin wrapper for NestJS DI / Swagger. Actual validation is done by Zod.
export class RequestOtpDto {
  @IsEmail()
  email!: string;
}
