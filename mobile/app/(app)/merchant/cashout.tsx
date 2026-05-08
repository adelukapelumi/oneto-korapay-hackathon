import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { requestCashout, Cashout } from "../../../src/api/cashout";
import { ApiError } from "../../../src/api/errors";

export default function CashoutScreen(): React.ReactElement {
  const router = useRouter();
  const { state } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<Cashout | null>(null);

  if (state.status !== "authed") {
    return <View />;
  }

  const { user, jwtFresh } = state;
  const balanceKobo = Number(user.verifiedBalanceKobo);
  const balanceNaira = (balanceKobo / 100).toFixed(2);

  const handleRequestCashout = async () => {
    if (balanceKobo <= 0) {
      setError("Your balance is zero.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await requestCashout();
      setSuccessData(res);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to request cashout");
      } else {
        setError(err.message || "An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ title: "Request Cashout", headerBackTitle: "Back" }} />
      <View style={styles.container}>
        {!jwtFresh && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              Sign in again to request a cashout.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>Current Balance</Text>
          <Text style={styles.balance}>₦{balanceNaira}</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {successData ? (
          <View style={styles.successBox}>
            <Text style={styles.successTitle}>Cashout Requested</Text>
            <Text style={styles.successText}>Amount: ₦{(Number(successData.amountKobo) / 100).toFixed(2)}</Text>
            <Text style={styles.successText}>Status: {successData.status}</Text>
            <Pressable
              style={styles.historyButton}
              onPress={() => router.replace("/(app)/merchant/cashout-history")}
            >
              <Text style={styles.historyButtonText}>View History</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[
              styles.primaryButton,
              (!jwtFresh || loading || balanceKobo <= 0) && styles.disabledButton,
            ]}
            onPress={handleRequestCashout}
            disabled={!jwtFresh || loading || balanceKobo <= 0}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Request Cashout</Text>
            )}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24 },
  staleBanner: {
    backgroundColor: "#fff5e6",
    borderColor: "#ffb84d",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  staleBannerText: { color: "#7a4d00", fontSize: 13 },
  card: {
    backgroundColor: "#f5f5f5",
    padding: 24,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 32,
  },
  label: { fontSize: 14, color: "#666", marginBottom: 8 },
  balance: { fontSize: 36, fontWeight: "700", color: "#000" },
  errorBox: {
    backgroundColor: "#ffebee",
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  errorText: { color: "#c62828", fontSize: 14 },
  successBox: {
    backgroundColor: "#e8f5e9",
    padding: 24,
    borderRadius: 16,
    alignItems: "center",
  },
  successTitle: { fontSize: 18, fontWeight: "600", color: "#2e7d32", marginBottom: 12 },
  successText: { fontSize: 16, color: "#1b5e20", marginBottom: 8 },
  historyButton: {
    marginTop: 16,
    backgroundColor: "#2e7d32",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  historyButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  primaryButton: {
    height: 52,
    backgroundColor: "#000",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  disabledButton: { opacity: 0.5 },
});
