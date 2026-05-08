import { StyleSheet, View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { TransactionEnvelope } from "@oneto/shared";

export default function DisplayScreen(): React.ReactElement | null {
  const router = useRouter();
  const { envelope: envelopeRaw } = useLocalSearchParams<{ envelope: string }>();

  let envelope: TransactionEnvelope | null = null;
  try {
    if (envelopeRaw) {
      envelope = JSON.parse(envelopeRaw);
    }
  } catch (e) {
    // Invalid JSON param
  }

  if (!envelope) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Invalid envelope data.</Text>
        <Pressable onPress={() => router.replace("/(app)/home")} style={styles.button}>
          <Text style={styles.buttonText}>Go Home</Text>
        </Pressable>
      </View>
    );
  }

  // Format amount as Naira (Kobo / 100)
  const amountNaira = (envelope.amountKobo / 100).toFixed(2);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.container}>
        <Text style={styles.successText}>Payment Signed!</Text>
        <Text style={styles.amountText}>₦{amountNaira}</Text>
        
        <Text style={styles.instructions}>
          Show this QR code to the merchant to complete your payment.
        </Text>

        <View style={styles.qrContainer}>
          <QRCode
            value={envelopeRaw}
            size={280}
            ecl="M" // Medium error correction allows some damage/glare while keeping payload dense
            quietZone={10}
          />
        </View>

        <Pressable
          style={styles.button}
          onPress={() => router.replace("/(app)/home")}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24, justifyContent: "center", alignItems: "center" },
  successText: { fontSize: 24, fontWeight: "700", color: "#0a0", marginBottom: 8 },
  amountText: { fontSize: 36, fontWeight: "800", marginBottom: 32 },
  instructions: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 32, paddingHorizontal: 20 },
  qrContainer: {
    padding: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 48,
  },
  button: {
    height: 52,
    width: "100%",
    backgroundColor: "#000",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c00", fontSize: 16, marginBottom: 24 },
});
