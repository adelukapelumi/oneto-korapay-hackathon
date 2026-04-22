import { z } from 'zod';

export const RequestOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const VerifyOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d+$/, 'OTP must be numeric'),
});

export type RequestOtpDtoType = z.infer<typeof RequestOtpSchema>;
export type VerifyOtpDtoType = z.infer<typeof VerifyOtpSchema>;
