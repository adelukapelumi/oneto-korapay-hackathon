import { IsEmail, IsString } from 'class-validator';

// Thin wrapper for NestJS DI / Swagger. Actual validation is done by Zod.
export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  code!: string;
}
