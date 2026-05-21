import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/auth-state";

// Locked is reachable only when state is "locked" — we have a keypair
// on disk and need a PIN to unlock it.
export default function LockedLayout(): React.ReactElement {
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
  if (state.status === "onboarding") {
    return <Redirect href="/(onboarding)/welcome" />;
  }
  if (state.status === "recovery_pending") {
    return <Redirect href="/(onboarding)/device-linked" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
