import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import {
  MERCHANT_SCAN_TITLE,
} from "../../../src/payment/merchant-flow";

export default function MerchantLayout() {
  const { state } = useAuth();

  if (state.status !== "authed") {
    return null;
  }

  if (state.user.role !== "MERCHANT") {
    return <Redirect href="/(app)/home" />;
  }

  return (
    <Stack>
      <Stack.Screen name="charge" options={{ title: MERCHANT_SCAN_TITLE }} />
      <Stack.Screen name="request-qr" options={{ title: MERCHANT_SCAN_TITLE }} />
      <Stack.Screen name="scan-envelope" options={{ title: MERCHANT_SCAN_TITLE }} />
      <Stack.Screen
        name="success"
        options={{ title: "Payment Received", headerLeft: () => null }}
      />
    </Stack>
  );
}
