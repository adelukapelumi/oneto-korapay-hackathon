import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { requestCashout, Cashout } from "../../../src/api/cashout";
import { ApiError } from "../../../src/api/errors";
import { BackButton } from "../../../components/BackButton";
import { useThemeMode } from "../../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  dimensions,
} from "../../../src/theme/tokens";

export default function CashoutScreen(): React.ReactElement {
  const router = useRouter();
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Request Cashout</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.container}>
        {!jwtFresh && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              Sign in again to request a cashout.
            </Text>
          </View>
        )}

        <View style={[styles.balanceCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <Text style={[styles.balanceLabel, { color: t.textSec }]}>Current Balance</Text>
          <Text style={[styles.balanceAmount, { color: t.text }]}>₦{balanceNaira}</Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {successData ? (
          <View style={[styles.successCard, { backgroundColor: t.card, borderColor: colors.primary }, t.shadow]}>
            <View style={styles.pixelRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[styles.pixel, i % 2 === 0 && styles.pixelFilled]} />
              ))}
            </View>
            <Text style={styles.successLabel}>CASHOUT REQUESTED</Text>
            <Text style={[styles.successAmount, { color: t.text }]}>
              ₦{(Number(successData.amountKobo) / 100).toFixed(2)}
            </Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>⏳ {successData.status}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.historyButton,
                { borderColor: t.border },
                t.shadow,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.replace("/(app)/merchant/cashout-history")}
            >
              <Text style={styles.historyButtonText}>View History →</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.spacer} />
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { borderColor: t.border },
                t.shadow,
                (!jwtFresh || loading || balanceKobo <= 0) && styles.disabledButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleRequestCashout}
              disabled={!jwtFresh || loading || balanceKobo <= 0}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.primaryButtonText}>Request Cashout</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
  },
  headerSpacer: { width: dimensions.headerBackButton.size },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingBottom: spacing["2xl"],
  },
  staleBanner: {
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "60",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  staleBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: "#7a4d00",
    textAlign: "center",
  },
  balanceCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  balanceLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  balanceAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    marginTop: spacing.xs,
    letterSpacing: -1,
  },
  errorBox: {
    backgroundColor: colors.error + "15",
    borderWidth: borders.thin,
    borderColor: colors.error + "30",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },
  successCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing["2xl"],
    alignItems: "center",
    gap: spacing.sm,
  },
  pixelRow: { flexDirection: "row", gap: 4, marginBottom: spacing.xs },
  pixel: { width: 8, height: 8, backgroundColor: "transparent" },
  pixelFilled: { backgroundColor: colors.primary },
  successLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.primary,
    letterSpacing: 1,
  },
  successAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    letterSpacing: -1,
  },
  statusBadge: {
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "40",
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  statusBadgeText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.secondary,
  },
  historyButton: {
    marginTop: spacing.md,
    width: "100%",
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  historyButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  spacer: { flex: 1 },
  primaryButton: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  disabledButton: { opacity: 0.5 },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
