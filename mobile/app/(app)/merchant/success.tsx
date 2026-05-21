import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { syncPendingEnvelopes } from "../../../src/api/reconcile";
import {
  MERCHANT_SCAN_ROUTE,
  MERCHANT_SCAN_SUCCESS_CTA,
} from "../../../src/payment/merchant-flow";
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
} from "../../../src/theme/tokens";

export default function SuccessScreen() {
  const { senderUserId, amountKobo } = useLocalSearchParams<{ senderUserId: string, amountKobo: string }>();
  const router = useRouter();
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const naira = (parseInt(amountKobo || "0", 10) / 100).toFixed(2);
  const truncatedSender = senderUserId ? `${senderUserId.substring(0, 8)}...` : "Customer";

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  useEffect(() => {
    if (state.status === "authed" && state.jwtFresh) {
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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.successCard,
            { backgroundColor: t.card, borderColor: t.border },
            t.shadow,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <View style={styles.pixelRow}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={[styles.pixel, i % 2 === 0 && styles.pixelFilled]} />
            ))}
          </View>

          <View style={[styles.iconWrap, t.shadow]}>
            <Text style={styles.iconText}>✓</Text>
          </View>

          <Text style={styles.pixelLabel}>PAYMENT SCANNED</Text>
          <Text style={[styles.amount, { color: t.text }]}>₦{naira}</Text>
          <Text style={[styles.subtitle, { color: t.textSec }]}>
            Student payment received from {truncatedSender}
          </Text>

          {state.status === "authed" && state.jwtFresh && (
            <View style={styles.syncBadge}>
              <Text style={styles.syncBadgeText}>⏳ Syncing...</Text>
            </View>
          )}
        </Animated.View>

        <View style={styles.spacer} />

        <View style={styles.buttonContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              { borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push(MERCHANT_SCAN_ROUTE)}
          >
            <Text style={styles.primaryButtonText}>{MERCHANT_SCAN_SUCCESS_CTA}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push("/(app)/home")}
          >
            <Text style={[styles.secondaryButtonText, { color: t.text }]}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: spacing["3xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  successCard: {
    width: "100%",
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing["2xl"],
    alignItems: "center",
    gap: spacing.sm,
  },
  pixelRow: { flexDirection: "row", gap: 4, marginBottom: spacing.md },
  pixel: { width: 8, height: 8, backgroundColor: "transparent" },
  pixelFilled: { backgroundColor: colors.primary },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    borderWidth: borders.medium,
    borderColor: colors.primaryText,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 32,
    color: colors.primaryText,
    includeFontPadding: false,
    lineHeight: 32,
  },
  pixelLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.primary,
    letterSpacing: 1,
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    letterSpacing: -1,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  syncBadge: {
    marginTop: spacing.md,
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "40",
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  syncBadgeText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.secondary,
  },
  spacer: { flex: 1 },
  buttonContainer: { width: "100%", gap: spacing.md },
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
  secondaryButton: {
    height: 52,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.button,
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
