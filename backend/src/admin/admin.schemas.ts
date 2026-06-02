import { z } from "zod";

const requiredStringField = (fieldName: string, maxLength: number) =>
  z.string().trim().min(1, `${fieldName} is required`).max(maxLength);

const optionalStringField = (maxLength: number) =>
  z
    .union([z.string().trim().max(maxLength), z.literal("")])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return undefined;
      }
      return value;
    });

export const AdminMerchantUserIdParamSchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
});

export const AdminCashoutIdParamSchema = z.object({
  id: z.string().trim().min(1, "cashout id is required"),
});

export const AdminMarkCashoutPaidSchema = z.object({
  externalReference: z
    .string()
    .trim()
    .min(1, "externalReference is required")
    .max(200),
  note: optionalStringField(500),
});

export const CreateAdminMerchantSchema = z.object({
  email: z.string().email("Invalid email address"),
  businessName: requiredStringField("businessName", 200),
  businessAddress: optionalStringField(500),
  cashoutBankName: requiredStringField("cashoutBankName", 100),
  cashoutBankCode: requiredStringField("cashoutBankCode", 20),
  cashoutAccountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Account number must be 10 digits"),
  cashoutAccountName: requiredStringField("cashoutAccountName", 200),
});

export const AdminResolveBankAccountSchema = z.object({
  bankCode: requiredStringField("bankCode", 20),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Account number must be 10 digits"),
});

export const UpdateAdminMerchantSchema = CreateAdminMerchantSchema.omit({
  email: true,
})
  .partial()
  .refine(
    (value) => Object.values(value).some((fieldValue) => fieldValue !== undefined),
    "At least one merchant field must be provided",
  );

export type AdminMerchantUserIdParamDto = z.infer<typeof AdminMerchantUserIdParamSchema>;
export type AdminCashoutIdParamDto = z.infer<typeof AdminCashoutIdParamSchema>;
export type AdminMarkCashoutPaidDto = z.infer<typeof AdminMarkCashoutPaidSchema>;
export type CreateAdminMerchantDto = z.infer<typeof CreateAdminMerchantSchema>;
export type UpdateAdminMerchantDto = z.infer<typeof UpdateAdminMerchantSchema>;
export type AdminResolveBankAccountDto = z.infer<typeof AdminResolveBankAccountSchema>;
