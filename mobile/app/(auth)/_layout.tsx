import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/auth-state";

// Gate: if the user is past auth (onboarding/locked/authed), bounce
// them away from the email/OTP screens. Renders nothing during loading
// so we don't briefly mount sign-in for an authed user.
export default function AuthLayout(): React.ReactElement {
  const { state } = useAuth();

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
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F5F0" },
});
