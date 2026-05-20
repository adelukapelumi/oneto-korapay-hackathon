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

export const CreateAdminMerchantSchema = z.object({
  email: z.string().email("Invalid email address"),
  businessName: requiredStringField("businessName", 200),
  businessAddress: optionalStringField(500),
  cashoutBankName: requiredStringField("cashoutBankName", 100),
  cashoutBankCode: z
    .string()
    .trim()
    .regex(/^[0-9]{3}$/, "Bank code must be 3 digits"),
  cashoutAccountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Account number must be 10 digits"),
  cashoutAccountName: requiredStringField("cashoutAccountName", 200),
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
export type CreateAdminMerchantDto = z.infer<typeof CreateAdminMerchantSchema>;
export type UpdateAdminMerchantDto = z.infer<typeof UpdateAdminMerchantSchema>;
