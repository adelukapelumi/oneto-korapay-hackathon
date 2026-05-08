import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import type { PaymentRequest } from "@oneto/shared";

export default function RequestQRScreen() {
  const { requestJson } = useLocalSearchParams<{ requestJson: string }>();
  const router = useRouter();

  if (!requestJson) return null;

  const request = JSON.parse(requestJson) as PaymentRequest;
  const naira = (request.amountKobo / 100).toFixed(2);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.amount}>₦{naira}</Text>
        <Text style={styles.subtitle}>Waiting for payment...</Text>

        <View style={styles.qrContainer}>
          <QRCode
            value={requestJson}
            size={250}
          />
        </View>

        <Pressable
          style={styles.button}
          onPress={() => router.push({
            pathname: "/(app)/merchant/scan-envelope",
            params: { requestJson }
          })}
        >
          <Text style={styles.buttonText}>Scan Response</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center" },
  amount: { fontSize: 36, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 48 },
  qrContainer: {
    padding: 24,
    backgroundColor: "#fff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 48,
  },
  button: {
    backgroundColor: "#0066cc",
    height: 56,
    width: "100%",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
