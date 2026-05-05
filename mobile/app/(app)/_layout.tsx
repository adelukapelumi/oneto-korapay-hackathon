import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/auth-state";

// Gate: only authed users see /home and friends. Other states route
// to their respective entry screens.
export default function AppLayout(): React.ReactElement {
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
  if (state.status === "onboarding") {
    return <Redirect href="/(onboarding)/welcome" />;
  }
  if (state.status === "locked") {
    return <Redirect href="/(locked)/pin-entry" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
