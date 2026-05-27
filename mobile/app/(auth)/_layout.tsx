import { Redirect, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/auth-state";
import { canAccessRecoveryReauthVerifyRoute } from "../../src/auth/recovery-reauth";

// Gate: if the user is past auth (onboarding/locked/authed), bounce
// them away from the email/OTP screens. Renders nothing during loading
// so we don't briefly mount sign-in for an authed user.
export default function AuthLayout(): React.ReactElement {
  const { state } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ returnTo?: string }>();

  if (state.status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (state.status === "authed") {
    return <Redirect href="/(app)/home" />;
  }
  if (state.status === "locked") {
    return <Redirect href="/(locked)/pin-entry" />;
  }
  if (state.status === "onboarding") {
    return <Redirect href="/(onboarding)/welcome" />;
  }
  if (state.status === "recovery_pending") {
    if (
      canAccessRecoveryReauthVerifyRoute({
        pathname,
        returnTo: typeof params.returnTo === "string" ? params.returnTo : undefined,
      })
    ) {
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    return <Redirect href="/(onboarding)/device-linked" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F5F0" },
});
