export interface IOtpProvider {
  sendOtp(target: string, code: string): Promise<void>;
}
