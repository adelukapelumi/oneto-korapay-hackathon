import { useCallback, useState, useRef } from "react";
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
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
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
import {
  getSpendableBalanceSnapshot,
  type SpendableBalanceSnapshot,
} from "../../../src/payment/balance-snapshot";
import { logger } from "../../../src/lib/logger";
import { PaymentRequest } from "@oneto/shared";
import { BackButton } from "../../../components/BackButton";
import { useThemeMode } from "../../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
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
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [balanceSnapshot, setBalanceSnapshot] = useState<SpendableBalanceSnapshot | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      if (state.status !== "authed" && state.status !== "locked") {
        return;
      }

      let isActive = true;
      setBalanceLoading(true);

      getSpendableBalanceSnapshot()
        .then((snapshot) => {
          if (!isActive) return;
          setBalanceSnapshot(snapshot);
          setError(null);
        })
        .catch((err) => {
          if (!isActive) return;
          setBalanceSnapshot(null);
          logger.info("Confirm balance refresh failed", err);
          setError(err instanceof Error ? err.message : "Could not load your balance.");
        })
        .finally(() => {
          if (isActive) {
            setBalanceLoading(false);
          }
        });

      return () => {
        isActive = false;
      };
    }, [state.status]),
  );

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
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={[styles.errorTitle, { color: t.text }]}>Invalid Request</Text>
          <Text style={[styles.errorText, { color: t.textSec }]}>
            This payment request could not be read.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.errorButton,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.back()}
          >
            <Text style={[styles.errorButtonText, { color: t.text }]}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const hasBalanceSnapshot = balanceSnapshot !== null;
  const balanceKobo = balanceSnapshot?.spendableBalanceKobo ?? Number(user.verifiedBalanceKobo);
  const canPay = hasBalanceSnapshot && balanceKobo >= paymentRequest.amountKobo;
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

    if (!hasBalanceSnapshot || !canPay) {
      setError("Could not confirm your latest spendable balance.");
      return;
    }

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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Confirm Payment</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Payment Card */}
        <View style={[styles.paymentCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <Text style={[styles.payingLabel, { color: t.textSec }]}>Paying</Text>
          <Text style={[styles.merchantName, { color: t.text }]}>
            {paymentRequest.merchantLabel || paymentRequest.merchantId}
          </Text>
          <Text style={[styles.amount, { color: t.text }, !canPay && styles.amountError]}>
            {formatNaira(paymentRequest.amountKobo)}
          </Text>

          <View style={[styles.divider, { backgroundColor: t.border }]} />

          <View style={styles.balanceRow}>
            <Text style={[styles.balanceLabel, { color: t.textSec }]}>Your balance</Text>
            {balanceLoading && !hasBalanceSnapshot ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.balanceValue, { color: t.text }]}>{formatNaira(balanceKobo)}</Text>
            )}
          </View>

          {balanceSnapshot && balanceSnapshot.pendingOutgoingKobo > 0 && (
            <Text style={[styles.pendingBalanceNote, { color: t.textMut }]}>
              Includes pending offline payments
            </Text>
          )}

          {canPay && (
            <View style={styles.balanceRow}>
              <Text style={[styles.balanceLabel, { color: t.textSec }]}>After payment</Text>
              <Text style={styles.balanceValueGreen}>{formatNaira(afterBalanceKobo)}</Text>
            </View>
          )}
        </View>

        {!hasBalanceSnapshot ? (
          <View style={styles.signingContainer}>
            {balanceLoading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.signingText, { color: t.textSec }]}>Loading balance...</Text>
              </>
            ) : error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null}
          </View>
        ) : canPay ? (
          <>
            {/* PIN Entry */}
            {signing ? (
              <View style={styles.signingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.signingText, { color: t.textSec }]}>Signing payment...</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.pinLabel, { color: t.textSec }]}>Enter PIN to confirm</Text>

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
                        { borderColor: t.border },
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
                              { borderColor: t.border, backgroundColor: t.keyBg },
                              t.shadow,
                              pressed && styles.numKeyPressed,
                            ]}
                            onPress={() =>
                              key === "del" ? onDelete() : onDigit(key as number)
                            }
                          >
                            <Text style={[styles.numKeyText, { color: t.text }]}>
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
                { borderColor: t.border },
                t.shadow,
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
          if (digits.length === PIN_LENGTH && canPay) {
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
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
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
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    alignItems: "center",
  },
  payingLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
  },
  merchantName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    marginTop: spacing.xs,
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: 40,
    marginTop: spacing.sm,
    letterSpacing: -1,
  },
  amountError: {
    color: colors.error,
  },
  divider: {
    width: "100%",
    height: 1,
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
  },
  balanceValue: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
  },
  balanceValueGreen: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.primary,
  },
  pendingBalanceNote: {
    alignSelf: "flex-start",
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },

  // PIN Entry
  pinLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
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
    alignItems: "center",
    justifyContent: "center",
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
    alignItems: "center",
    justifyContent: "center",
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

  // Hidden input
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },
});
