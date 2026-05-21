import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/auth-state";

// Onboarding is reachable only when state is "onboarding" — the user
// has just completed OTP but doesn't yet have a keypair on this device.
export default function OnboardingLayout(): React.ReactElement {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (state.status === "unauthed") {
    return <Redirect href="/(auth)/sign-in" />;
  }
  if (state.status === "authed") {
    return <Redirect href="/(app)/home" />;
  }
  if (state.status === "locked") {
    return <Redirect href="/(locked)/pin-entry" />;
  }
  if (state.status === "recovery_pending") {
    return <Stack screenOptions={{ headerShown: false }} />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F5F0" },
});
