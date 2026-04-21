export interface ISmsProvider {
  sendSms(phone: string, message: string): Promise<void>;
}
