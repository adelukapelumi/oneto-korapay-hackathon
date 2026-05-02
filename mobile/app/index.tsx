import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../src/auth/auth-state";

// The root entry point. Decides where to send the user based on auth state.
// While the auth bootstrap is in flight, render a tiny splash so the user
// doesn't see a flash of /sign-in before being redirected to /home.
export default function Index(): React.ReactElement {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (status === "authed") {
    return <Redirect href="/(app)/home" />;
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
