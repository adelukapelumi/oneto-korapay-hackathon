import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import type { PaymentRequest } from "@oneto/shared";
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

export default function RequestQRScreen() {
  const { requestJson } = useLocalSearchParams<{ requestJson: string }>();
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  if (!requestJson) return null;

  const request = JSON.parse(requestJson) as PaymentRequest;
  const naira = (request.amountKobo / 100).toFixed(2);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <View style={styles.headerSpacer} />
        <Text style={[styles.headerLabel, { color: t.textSec }]}>Payment Request</Text>
      </View>

      <View style={styles.container}>
        <Text style={styles.pixelLabel}>AWAITING PAYMENT</Text>
        <Text style={[styles.amount, { color: t.text }]}>₦{naira}</Text>

        <View style={[styles.qrCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <View style={styles.qrInner}>
            <QRCode
              value={requestJson}
              size={240}
              ecl="M"
              quietZone={8}
              color={colors.primaryText}
              backgroundColor="#FFFFFF"
            />
          </View>
        </View>

        <Text style={[styles.instruction, { color: t.textSec }]}>
          Show this QR to the customer
        </Text>

        <View style={styles.spacer} />

        <Pressable
          style={({ pressed }) => [
            styles.button,
            { borderColor: t.border },
            t.shadow,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => router.push({
            pathname: "/(app)/merchant/scan-envelope",
            params: { requestJson }
          })}
        >
          <Text style={styles.buttonText}>Scan Response →</Text>
        </Pressable>
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
  headerSpacer: { flex: 1 },
  headerLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingBottom: spacing["2xl"],
    alignItems: "center",
  },
  pixelLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.md,
    color: colors.secondary,
    marginBottom: spacing.sm,
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    letterSpacing: -1,
    marginBottom: spacing["2xl"],
  },
  qrCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
  },
  qrInner: {
    borderRadius: radii.sm,
    overflow: "hidden",
  },
  instruction: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    marginTop: spacing.lg,
    textAlign: "center",
  },
  spacer: { flex: 1 },
  button: {
    width: "100%",
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
