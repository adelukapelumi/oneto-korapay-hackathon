import { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { TransactionEnvelope } from "@oneto/shared";
import {
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  shadows,
} from "../../../src/theme/tokens";

function formatNaira(kobo: number): string {
  return "₦" + (kobo / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function DisplayScreen(): React.ReactElement | null {
  const router = useRouter();
  const { envelope: envelopeRaw } = useLocalSearchParams<{ envelope: string }>();

  // Floating sparkle animation
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -8,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [floatAnim]);

  // Fade in animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
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

  let envelope: TransactionEnvelope | null = null;
  try {
    if (envelopeRaw) {
      envelope = JSON.parse(envelopeRaw);
    }
  } catch {
    // Invalid JSON param
  }

  if (!envelope) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Invalid Data</Text>
          <Text style={styles.errorText}>
            The payment envelope could not be read.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.errorButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.replace("/(app)/home")}
          >
            <Text style={styles.errorButtonText}>Go Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        {/* Header */}
        <Animated.View
          style={[
            styles.headerSection,
            { opacity: fadeAnim },
          ]}
        >
          <Text style={styles.pixelLabel}>PAYMENT SIGNED</Text>
          <Text style={styles.title}>Show this to the merchant</Text>
        </Animated.View>

        {/* QR Card */}
        <Animated.View
          style={[
            styles.qrCard,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Sparkle decoration */}
          <Animated.View
            style={[
              styles.sparkle,
              { transform: [{ translateY: floatAnim }, { rotate: "45deg" }] },
            ]}
          />

          <View style={styles.qrInner}>
            <QRCode
              value={envelopeRaw}
              size={240}
              ecl="M"
              quietZone={8}
              color={colors.primaryText}
              backgroundColor="#FFFFFF"
            />
          </View>
        </Animated.View>

        {/* Amount & Merchant */}
        <Animated.View
          style={[
            styles.detailsSection,
            { opacity: fadeAnim },
          ]}
        >
          <Text style={styles.amount}>{formatNaira(envelope.amountKobo)}</Text>
          <Text style={styles.merchantLabel}>
            to {envelope.recipientUserId.slice(0, 12)}...
          </Text>
        </Animated.View>

        {/* Status badge */}
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>⏳ Pending sync</Text>
        </View>

        <View style={styles.spacer} />

        {/* Done Button */}
        <Pressable
          style={({ pressed }) => [
            styles.doneButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => router.replace("/(app)/home")}
          accessibilityRole="button"
        >
          <Text style={styles.doneButtonText}>Done ✓</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.light.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing["2xl"],
    alignItems: "center",
  },

  // Header
  headerSection: {
    alignItems: "center",
    marginBottom: spacing["2xl"],
  },
  pixelLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.md,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    color: colors.light.text,
    textAlign: "center",
  },

  // QR Card
  qrCard: {
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    position: "relative",
    ...shadows.neu.light,
    // Glow effect
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
  },
  sparkle: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 12,
    height: 12,
    backgroundColor: colors.secondary,
  },
  qrInner: {
    borderRadius: radii.sm,
    overflow: "hidden",
  },

  // Details
  detailsSection: {
    alignItems: "center",
    marginTop: spacing["2xl"],
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    color: colors.light.text,
    letterSpacing: -1,
  },
  merchantLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    marginTop: spacing.xs,
  },

  // Status Badge
  statusBadge: {
    marginTop: spacing.lg,
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "40",
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  statusText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.secondary,
  },

  spacer: {
    flex: 1,
  },

  // Done Button
  doneButton: {
    width: "100%",
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  doneButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },

  // Error Screen
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    color: colors.light.text,
    marginBottom: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  errorButton: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    backgroundColor: colors.light.card,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    ...shadows.neu.light,
  },
  errorButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.button,
    color: colors.light.text,
  },

  // Shared
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
