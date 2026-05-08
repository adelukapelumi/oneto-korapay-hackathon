import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useState, useCallback } from "react";
import { MAX_USER_BALANCE_KOBO } from "@oneto/shared";
import { useAuth } from "../../src/auth/auth-state";
import { listPendingByStatus } from "../../src/ledger/db";
import { syncPendingEnvelopes } from "../../src/api/reconcile";
import { useFocusEffect } from "expo-router";

export default function HomeScreen(): React.ReactElement {
  const { state, signOut } = useAuth();
  const router = useRouter();

  if (state.status !== "authed") {
    // The (app) layout's gate guarantees this is unreachable, but
    // TypeScript can't know that. Render-time guard, no non-null assertion.
    return <View />;
  }
  const user = state.user;
  const jwtFresh = state.jwtFresh;

  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user.role === "MERCHANT") {
        const pending = listPendingByStatus("pending_reconciliation", "incoming");
        setPendingCount(pending.length);
      }
    }, [user.role])
  );

  const handleSync = async () => {
    setIsSyncing(true);
    await syncPendingEnvelopes();
    const pending = listPendingByStatus("pending_reconciliation", "incoming");
    setPendingCount(pending.length);
    setIsSyncing(false);
  };

  // verifiedBalanceKobo is a string-encoded BigInt. Pilot balances are
  // capped at MAX_USER_BALANCE_KOBO (well under Number.MAX_SAFE_INTEGER),
  // so plain Number conversion is safe here.
  const balanceKobo = Number(user.verifiedBalanceKobo);
  const naira = (balanceKobo / 100).toFixed(2);
  const capRemainingNaira = ((MAX_USER_BALANCE_KOBO - balanceKobo) / 100).toFixed(0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {!jwtFresh ? (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              Sign in again to top up or see your latest balance.
            </Text>
          </View>
        ) : null}

        <Text style={styles.greeting}>Hello,</Text>
        <Text style={styles.email}>{user.email || "—"}</Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Balance</Text>
          <Text style={styles.balance}>₦{naira}</Text>
          <Text style={styles.balanceCap}>
            {jwtFresh
              ? `You can top up up to ₦${capRemainingNaira} more`
              : "Last known balance — sign in again to refresh."}
          </Text>
        </View>

        {user.role === "STUDENT" ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.push("/(app)/pay/scan")}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Pay Merchant</Text>
          </Pressable>
        ) : (
          <View style={styles.merchantSection}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push("/(app)/merchant/charge")}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Charge Customer</Text>
            </Pressable>
            
            <View style={styles.syncCard}>
              <View>
                <Text style={styles.syncCardTitle}>Pending Syncs</Text>
                <Text style={styles.syncCardCount}>{pendingCount} payments</Text>
              </View>
              <Pressable
                style={[styles.syncButton, (isSyncing || pendingCount === 0 || !jwtFresh) && styles.syncButtonDisabled]}
                onPress={handleSync}
                disabled={isSyncing || pendingCount === 0 || !jwtFresh}
              >
                <Text style={styles.syncButtonText}>{isSyncing ? "Syncing..." : "Sync Now"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Role</Text>
          <Text style={styles.metaValue}>{user.role}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Status</Text>
          <Text style={styles.metaValue}>{user.status}</Text>
        </View>

        <Pressable
          style={styles.secondary}
          onPress={() => router.push("/(app)/change-pin")}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Change PIN</Text>
        </Pressable>

        <Pressable
          style={styles.signOut}
          onPress={() => {
            void signOut();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
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
    marginBottom: 16,
  },
  staleBannerText: { color: "#7a4d00", fontSize: 13 },
  greeting: { fontSize: 16, color: "#666", marginTop: 24 },
  email: { fontSize: 22, fontWeight: "600", marginBottom: 32 },
  balanceCard: {
    backgroundColor: "#000",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  balanceLabel: { color: "#aaa", fontSize: 14 },
  balance: { color: "#fff", fontSize: 36, fontWeight: "700", marginTop: 8 },
  balanceCap: { color: "#888", fontSize: 12, marginTop: 8 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  metaLabel: { color: "#666", fontSize: 14 },
  metaValue: { color: "#000", fontSize: 14, fontWeight: "500" },
  primaryButton: {
    marginBottom: 24,
    height: 52,
    backgroundColor: "#0066cc",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  secondary: {
    marginTop: 16,
    height: 52,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 16, fontWeight: "500", color: "#000" },
  signOut: {
    marginTop: "auto",
    height: 52,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { fontSize: 16, fontWeight: "600", color: "#000" },
  merchantSection: { marginBottom: 24 },
  syncCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 12,
  },
  syncCardTitle: { fontSize: 14, color: "#666" },
  syncCardCount: { fontSize: 18, fontWeight: "600", color: "#000", marginTop: 4 },
  syncButton: {
    backgroundColor: "#000",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { color: "#fff", fontWeight: "500", fontSize: 14 },
});
