import { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { syncPendingEnvelopes } from "../../../src/api/reconcile";

export default function SuccessScreen() {
  const { senderUserId, amountKobo } = useLocalSearchParams<{ senderUserId: string, amountKobo: string }>();
  const router = useRouter();
  const { state } = useAuth();

  const naira = (parseInt(amountKobo || "0", 10) / 100).toFixed(2);
  const truncatedSender = senderUserId ? `${senderUserId.substring(0, 8)}...` : "Customer";

  useEffect(() => {
    if (state.status === "authed" && state.jwtFresh) {
      // Auto-sync in background silently
      void syncPendingEnvelopes();
    }
  }, [state]);

  const handleManualSync = async () => {
    if (state.status === "authed" && state.jwtFresh) {
      await syncPendingEnvelopes();
      router.push("/(app)/home");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>✅</Text>
        </View>
        <Text style={styles.title}>Payment Received</Text>
        <Text style={styles.amount}>₦{naira}</Text>
        <Text style={styles.subtitle}>from {truncatedSender}</Text>

        <View style={styles.buttonContainer}>
          {state.status === "authed" && state.jwtFresh ? (
            <Pressable style={styles.syncButton} onPress={handleManualSync}>
              <Text style={styles.syncButtonText}>Sync Now</Text>
            </Pressable>
          ) : (
            <Text style={styles.offlineText}>Will sync later when online</Text>
          )}

          <Pressable
            style={styles.newButton}
            onPress={() => router.push("/(app)/merchant/charge")}
          >
            <Text style={styles.newButtonText}>New Payment</Text>
          </Pressable>
          
          <Pressable
            style={styles.homeButton}
            onPress={() => router.push("/(app)/home")}
          >
            <Text style={styles.homeButtonText}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center" },
  iconContainer: { marginBottom: 24 },
  icon: { fontSize: 64 },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 16 },
  amount: { fontSize: 48, fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#666", marginBottom: 48 },
  buttonContainer: { width: "100%", gap: 16 },
  syncButton: {
    backgroundColor: "#e6f2ff",
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  syncButtonText: { color: "#0066cc", fontSize: 18, fontWeight: "600" },
  offlineText: { textAlign: "center", color: "#666", marginVertical: 12 },
  newButton: {
    backgroundColor: "#000",
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  newButtonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  homeButton: {
    backgroundColor: "#fff",
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
  },
  homeButtonText: { color: "#000", fontSize: 18, fontWeight: "600" },
});
