import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to oneto</Text>
        <Text style={styles.body}>
          Let's set up your account. We'll create a secure keypair on this
          device and protect it with a 6-digit PIN. The PIN never leaves
          your phone.
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => router.push("/(onboarding)/pin-setup")}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 32, fontWeight: "700", marginBottom: 16 },
  body: { fontSize: 16, color: "#444", lineHeight: 22, marginBottom: 32 },
  button: {
    height: 52,
    backgroundColor: "#000",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
