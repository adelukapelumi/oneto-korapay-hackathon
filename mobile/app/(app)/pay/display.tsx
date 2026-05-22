import { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { TransactionEnvelope } from "@oneto/shared";
import { Screen } from "../../../components/Screen";
import { useCompactLayout } from "../../../src/ui/responsive";
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

function formatNaira(kobo: number): string {
  return "₦" + (kobo / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function DisplayScreen(): React.ReactElement | null {
  const router = useRouter();
  const { envelope: envelopeRaw } = useLocalSearchParams<{ envelope: string }>();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const compact = useCompactLayout();

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
      <Screen>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={[styles.errorTitle, { color: t.text }]}>Invalid Data</Text>
          <Text style={[styles.errorText, { color: t.textSec }]}>
            The payment envelope could not be read.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.errorButton,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.replace("/(app)/home")}
          >
            <Text style={[styles.errorButtonText, { color: t.text }]}>Go Home</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }
  return (
    <Screen
      scroll
      contentContainerStyle={{
        paddingHorizontal: compact.horizontalPadding,
        paddingTop: compact.topPadding,
        paddingBottom: spacing["2xl"],
      }}
    >
      <View style={styles.container}>
        {/* Header */}
        <Animated.View
          style={[
            styles.headerSection,
            { opacity: fadeAnim },
          ]}
        >
          <Text style={styles.pixelLabel}>PAYMENT SIGNED</Text>
          <Text style={[styles.title, { color: t.text }]}>Show this to the merchant</Text>
        </Animated.View>

        {/* QR Card */}
        <Animated.View
          style={[
            styles.qrCard,
            {
              backgroundColor: t.card,
              borderColor: t.border,
              padding: compact.isVeryShort ? spacing.lg : spacing.cardPadLg,
            },
            t.shadow,
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
              size={compact.qrSize}
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
          <Text style={[styles.amount, { color: t.text }]}>{formatNaira(envelope.amountKobo)}</Text>
          <Text style={[styles.merchantLabel, { color: t.textSec }]}>
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
            { height: compact.buttonHeight, borderColor: t.border },
            t.shadow,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => router.replace("/(app)/home")}
          accessibilityRole="button"
        >
          <Text style={styles.doneButtonText}>Done ✓</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    textAlign: "center",
  },

  // QR Card
  qrCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    position: "relative",
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
    letterSpacing: -1,
  },
  merchantLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
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
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
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
    marginBottom: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  errorButton: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
  },
  errorButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.button,
  },

  // Shared
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
