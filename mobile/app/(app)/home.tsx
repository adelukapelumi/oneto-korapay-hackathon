import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MAX_USER_BALANCE_KOBO } from "@oneto/shared";
import { useAuth } from "../../src/auth/auth-state";

// Placeholder. 2.1's only requirement is "logged-in user lands somewhere
// that proves auth worked." Real home screen lands in 2.2.
export default function HomeScreen(): React.ReactElement {
  const { user, signOut } = useAuth();

  if (!user) {
    // (app) layout's gate guarantees this is unreachable, but TypeScript
    // doesn't know that. Render-time guard instead of non-null assertion.
    return <View />;
  }

  // verifiedBalanceKobo is a string-encoded BigInt. Pilot balances are
  // capped at MAX_USER_BALANCE_KOBO (well under Number.MAX_SAFE_INTEGER),
  // so plain Number conversion is safe here.
  const balanceKobo = Number(user.verifiedBalanceKobo);
  const naira = (balanceKobo / 100).toFixed(2);
  const capRemainingNaira = ((MAX_USER_BALANCE_KOBO - balanceKobo) / 100).toFixed(0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.greeting}>Hello,</Text>
        <Text style={styles.email}>{user.email}</Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Balance</Text>
          <Text style={styles.balance}>₦{naira}</Text>
          <Text style={styles.balanceCap}>
            You can top up up to ₦{capRemainingNaira} more
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Role</Text>
          <Text style={styles.metaValue}>{user.role}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Status</Text>
          <Text style={styles.metaValue}>{user.status}</Text>
        </View>

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
});
