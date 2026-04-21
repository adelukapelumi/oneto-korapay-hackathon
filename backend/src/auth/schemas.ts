import { z } from 'zod';

export const RequestOtpSchema = z.object({
  phone: z.string().min(10).max(15).regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
});

export const VerifyOtpSchema = z.object({
  phone: z.string().min(10).max(15).regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  code: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d+$/, 'OTP must be numeric'),
});

export type RequestOtpDtoType = z.infer<typeof RequestOtpSchema>;
export type VerifyOtpDtoType = z.infer<typeof VerifyOtpSchema>;
