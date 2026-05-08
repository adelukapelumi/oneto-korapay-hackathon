import { useState, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import {
  PinIncorrectError,
  PinLockedError,
  unlockKeypairWithPin,
} from "../../../src/crypto/pin-derive";
import { insertPendingTransaction } from "../../../src/ledger/db";
import {
  buildAndSignEnvelope,
  InsufficientBalanceError,
} from "../../../src/payment/build-envelope";
import { logger } from "../../../src/lib/logger";
import { PaymentRequest } from "@oneto/shared";
import {
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  shadows,
  dimensions,
} from "../../../src/theme/tokens";

const PIN_LENGTH = 6;

const NUM_ROWS: (number | "del" | "")[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  ["", 0, "del"],
];

function formatNaira(kobo: number): string {
  return "₦" + (kobo / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ConfirmPaymentScreen(): React.ReactElement | null {
  const router = useRouter();
  const { request } = useLocalSearchParams<{ request: string }>();
  const { state } = useAuth();

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  if (state.status !== "authed" && state.status !== "locked") {
    return null;
  }
  const user = state.user;

  let paymentRequest: PaymentRequest | null = null;
  try {
    if (request) {
      paymentRequest = JSON.parse(request);
    }
  } catch {
    // Invalid JSON param
  }

  if (!paymentRequest) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Invalid Request</Text>
          <Text style={styles.errorText}>
            This payment request could not be read.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.errorButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.back()}
          >
            <Text style={styles.errorButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const balanceKobo = Number(user.verifiedBalanceKobo);
  const canPay = balanceKobo >= paymentRequest.amountKobo;
  const afterBalanceKobo = balanceKobo - paymentRequest.amountKobo;

  function triggerShake(): void {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  function onDigit(d: number): void {
    if (pin.length >= PIN_LENGTH || signing || !canPay) return;
    const next = pin + String(d);
    setPin(next);
    setError(null);
    if (next.length === PIN_LENGTH) {
      void onSubmit(next);
    }
  }

  function onDelete(): void {
    if (signing) return;
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  async function onSubmit(pinValue: string): Promise<void> {
    setError(null);
    setSigning(true);

    try {
      const { privateKey, publicKey } = await unlockKeypairWithPin(pinValue);

      try {
        const envelope = buildAndSignEnvelope({
          paymentRequest: paymentRequest!,
          senderUserId: user.id,
          senderPublicKey: publicKey,
          privateKey,
        });

        insertPendingTransaction({
          id: envelope.transactionId,
          envelopeJson: JSON.stringify(envelope),
          recipientId: envelope.recipientUserId,
          recipientLabel: paymentRequest!.merchantLabel,
          amountKobo: envelope.amountKobo,
          sequenceNumber: envelope.senderSequenceNumber,
          direction: "outgoing",
          createdAt: envelope.timestamp,
        });

        router.replace({
          pathname: "/(app)/pay/display",
          params: { envelope: JSON.stringify(envelope) },
        });
      } finally {
        privateKey.fill(0);
      }
    } catch (err) {
      triggerShake();
      setPin("");

      if (err instanceof PinIncorrectError) {
        setError("Incorrect PIN. Try again.");
      } else if (err instanceof PinLockedError) {
        setError("Too many attempts. Try again later.");
      } else if (err instanceof InsufficientBalanceError) {
        setError(`Insufficient balance. Available: ${formatNaira(err.available)}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        logger.warn("Confirm payment unexpected error", String(err));
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSigning(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Confirm Payment</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Payment Card */}
        <View style={styles.paymentCard}>
          <Text style={styles.payingLabel}>Paying</Text>
          <Text style={styles.merchantName}>
            {paymentRequest.merchantLabel || paymentRequest.merchantId}
          </Text>
          <Text style={[styles.amount, !canPay && styles.amountError]}>
            {formatNaira(paymentRequest.amountKobo)}
          </Text>

          <View style={styles.divider} />

          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Your balance</Text>
            <Text style={styles.balanceValue}>{formatNaira(balanceKobo)}</Text>
          </View>

          {canPay && (
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>After payment</Text>
              <Text style={styles.balanceValueGreen}>{formatNaira(afterBalanceKobo)}</Text>
            </View>
          )}
        </View>

        {canPay ? (
          <>
            {/* PIN Entry */}
            {signing ? (
              <View style={styles.signingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.signingText}>Signing payment...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.pinLabel}>Enter PIN to confirm</Text>

                {/* PIN Dots */}
                <Animated.View
                  style={[
                    styles.dotsRow,
                    { transform: [{ translateX: shakeAnim }] },
                  ]}
                >
                  {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        i < pin.length && styles.dotFilled,
                      ]}
                    />
                  ))}
                </Animated.View>

                {/* Error */}
                {error ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorBannerText}>{error}</Text>
                  </View>
                ) : (
                  <View style={styles.errorSpacer} />
                )}

                {/* NumPad */}
                <View style={styles.numPad}>
                  {NUM_ROWS.map((row, ri) => (
                    <View key={ri} style={styles.numRow}>
                      {row.map((key, ki) => {
                        if (key === "") {
                          return <View key={ki} style={styles.numKeyEmpty} />;
                        }
                        return (
                          <Pressable
                            key={ki}
                            style={({ pressed }) => [
                              styles.numKey,
                              pressed && styles.numKeyPressed,
                            ]}
                            onPress={() =>
                              key === "del" ? onDelete() : onDigit(key as number)
                            }
                          >
                            <Text style={styles.numKeyText}>
                              {key === "del" ? "⌫" : key}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        ) : (
          /* Insufficient Balance */
          <View style={styles.insufficientContainer}>
            <Text style={styles.insufficientText}>Not enough balance</Text>
            <Pressable
              style={({ pressed }) => [
                styles.topUpButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/(app)/topup/amount")}
            >
              <Text style={styles.topUpButtonText}>Top Up to Continue</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Hidden TextInput for accessibility */}
      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        value={pin}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
          setPin(digits);
          if (digits.length === PIN_LENGTH) {
            void onSubmit(digits);
          }
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        secureTextEntry
        maxLength={PIN_LENGTH}
        textContentType="oneTimeCode"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.light.bg,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  backButton: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.card,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    fontSize: 18,
    color: colors.light.text,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
    color: colors.light.text,
  },
  headerSpacer: {
    width: dimensions.headerBackButton.size,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing.sm,
    paddingBottom: spacing["2xl"],
  },

  // Payment Card
  paymentCard: {
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    alignItems: "center",
    ...shadows.neu.light,
  },
  payingLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.light.textSec,
  },
  merchantName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    color: colors.light.text,
    marginTop: spacing.xs,
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: 40,
    color: colors.light.text,
    marginTop: spacing.sm,
    letterSpacing: -1,
  },
  amountError: {
    color: colors.error,
  },
  divider: {
    width: "100%",
    height: 1,
    backgroundColor: colors.light.border,
    marginVertical: spacing.lg,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: spacing.xs,
  },
  balanceLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
  },
  balanceValue: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.light.text,
  },
  balanceValueGreen: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.primary,
  },

  // PIN Entry
  pinLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    textAlign: "center",
    marginTop: spacing["2xl"],
  },
  dotsRow: {
    flexDirection: "row",
    gap: dimensions.pinDot.gap,
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  dot: {
    width: dimensions.pinDot.size,
    height: dimensions.pinDot.size,
    borderRadius: dimensions.pinDot.size / 2,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    backgroundColor: "transparent",
  },
  dotFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    transform: [{ scale: 1.15 }],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },

  // Error
  errorBanner: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.error + "15",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.error + "30",
  },
  errorBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },
  errorSpacer: {
    height: 44,
    marginTop: spacing.lg,
  },

  // NumPad
  numPad: {
    marginTop: spacing.lg,
    gap: dimensions.numPadGap.row,
    alignItems: "center",
  },
  numRow: {
    flexDirection: "row",
    gap: dimensions.numPadGap.col,
  },
  numKey: {
    width: dimensions.numPadKey.size,
    height: dimensions.numPadKey.size,
    borderRadius: dimensions.numPadKey.size / 2,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.keyBg,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  numKeyPressed: {
    transform: [{ scale: 0.9 }],
  },
  numKeyEmpty: {
    width: dimensions.numPadKey.size,
    height: dimensions.numPadKey.size,
  },
  numKeyText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.numPad,
    color: colors.light.text,
  },

  // Signing
  signingContainer: {
    alignItems: "center",
    marginTop: spacing["4xl"],
    gap: spacing.lg,
  },
  signingText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
  },

  // Insufficient Balance
  insufficientContainer: {
    alignItems: "center",
    marginTop: spacing["2xl"],
  },
  insufficientText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.bodyLg,
    color: colors.error,
    marginBottom: spacing.lg,
  },
  topUpButton: {
    width: "100%",
    height: 52,
    backgroundColor: colors.secondary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  topUpButtonText: {
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

  // Hidden input
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },
});
