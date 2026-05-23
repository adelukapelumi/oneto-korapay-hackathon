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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="charge" />
      <Stack.Screen name="request-qr" />
      <Stack.Screen name="scan-envelope" />
      <Stack.Screen
        name="success"
        options={{ headerLeft: () => null }}
      />
    </Stack>
  );
}
