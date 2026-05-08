import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";

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
      <Stack.Screen name="charge" options={{ title: "Charge Customer" }} />
      <Stack.Screen name="request-qr" options={{ title: "Payment QR" }} />
      <Stack.Screen name="scan-envelope" options={{ title: "Scan Payment" }} />
      <Stack.Screen name="success" options={{ title: "Payment Received", headerLeft: () => null }} />
    </Stack>
  );
}
