import { z } from 'zod';

export const RequestOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const VerifyOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d+$/, 'OTP must be numeric'),
});

// Admin auth endpoints intentionally accept non-email strings at the schema
// boundary so the service can respond with generic, enumeration-safe behavior.
export const RequestAdminOtpSchema = z.object({
  email: z.string(),
});

export const VerifyAdminOtpSchema = z.object({
  email: z.string(),
  code: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d+$/, 'OTP must be numeric'),
});

export type RequestOtpDtoType = z.infer<typeof RequestOtpSchema>;
export type VerifyOtpDtoType = z.infer<typeof VerifyOtpSchema>;
export type RequestAdminOtpDtoType = z.infer<typeof RequestAdminOtpSchema>;
export type VerifyAdminOtpDtoType = z.infer<typeof VerifyAdminOtpSchema>;

export const RequestMerchantOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  businessName: z.string().min(2).max(200),
  businessAddress: z.string().max(500).optional(),
  phone: z.string().optional(),
  cashoutBankName: z.string().min(2).max(100),
  cashoutBankCode: z.string().regex(/^[0-9]{3}$/, 'Bank code must be 3 digits'),
  cashoutAccountNumber: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  cashoutAccountName: z.string().min(2).max(200),
});

export const VerifyMerchantOtpSchema = VerifyOtpSchema;

export type RequestMerchantOtpDtoType = z.infer<typeof RequestMerchantOtpSchema>;


export const RegisterKeySchema = z.object({
  publicKey: z.string().regex(/^ed25519:[0-9a-f]{64}$/, 'Invalid public key format'),
  rotationSignature: z.string().regex(/^ed25519:[0-9a-f]{128}$/, 'Invalid rotation signature format').optional(),
});

export type RegisterKeyDtoType = z.infer<typeof RegisterKeySchema>;
