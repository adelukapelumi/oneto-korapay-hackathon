import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../src/auth/auth-state";

// Decides where to send the user based on app state. While bootstrap
// is in flight we render a tiny splash so the user doesn't see a flash
// of /sign-in before we've checked storage.
export default function Index(): React.ReactElement {
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
  return <Redirect href="/(auth)/sign-in" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
