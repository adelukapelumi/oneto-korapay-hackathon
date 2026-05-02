import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/auth-state";

// Gate: if already signed in, bounce to /home. Renders nothing during
// "loading" so we don't briefly mount sign-in screens for an authed user.
export default function AuthLayout(): React.ReactElement {
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
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
