import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { fetchMe, requestOtp, verifyOtp } from "../../src/api/auth";
import { NetworkError, UnauthorizedError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/auth-state";
import { setToken } from "../../src/auth/token-store";
import { logger } from "../../src/lib/logger";
import { BackButton } from "../../components/BackButton";
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
} from "../../src/theme/tokens";

const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;

export default function VerifyScreen(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const { signIn } = useAuth();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [verified, setVerified] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const verifiedScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  // Auto-submit when the user types the 6th digit.
  useEffect(() => {
    if (code.length === 6 && !submitting) {
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function triggerShake(): void {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  async function submit(value: string): Promise<void> {
    if (!email) {
      setError("Missing email. Go back and try again.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { accessToken } = await verifyOtp(email, value);
      await setToken(accessToken);
      const me = await fetchMe();

      // Show verified state briefly before transitioning.
      setVerified(true);
      Animated.spring(verifiedScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 120,
        friction: 8,
      }).start();
      await new Promise<void>((resolve) => setTimeout(resolve, 1300));

      await signIn(accessToken, me);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError(err.message);
      } else if (err instanceof UnauthorizedError) {
        setError("Code didn't match. Try again.");
      } else {
        setError("Something went wrong. Try again.");
      }
      triggerShake();
      setCode("");
      // Delay the focus call so Android processes the state update first.
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend(): Promise<void> {
    if (!email || resendCooldown > 0) return;
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setError(null);
    try {
      await requestOtp(email);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError(err.message);
        return;
      }
      logger.info("Resend non-network error; staying silent");
    }
    // Re-focus the input after resend so keyboard stays up.
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <BackButton />
        </View>

        <View style={styles.container}>
          <Text style={styles.stepLabel}>STEP 2</Text>
          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.subtitle}>We sent a 6-digit code to</Text>
          <Text style={styles.emailText}>{email}</Text>

          {/* OTP area */}
          <Animated.View
            style={[
              styles.otpContainer,
              { transform: [{ translateX: shakeAnim }] },
            ]}
          >
            {verified ? (
              <Animated.View
                style={[
                  styles.verifiedWrap,
                  {
                    transform: [{ scale: verifiedScale }],
                    opacity: verifiedScale,
                  },
                ]}
              >
                <View style={styles.verifiedCircle}>
                  <Text style={styles.verifiedTick}>✓</Text>
                </View>
                <Text style={styles.verifiedLabel}>VERIFIED</Text>
              </Animated.View>
            ) : submitting ? (
              <View style={styles.spinnerWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <View style={styles.otpArea}>
                {/* Visual OTP cells — pointerEvents="none" so taps
                    pass through to the TextInput behind them */}
                <View style={styles.otpCells} pointerEvents="none">
                  {Array.from({ length: CODE_LENGTH }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.otpCell,
                        code[i] ? styles.otpCellFilled : null,
                      ]}
                    >
                      <Text style={styles.otpDigit}>{code[i] || ""}</Text>
                    </View>
                  ))}
                </View>

                {/*
                  Full-size invisible TextInput overlaid on the OTP cells.
                  This is the key fix: the old TextInput was 1×1 px which
                  Android refused to focus after the initial mount. By making
                  it cover the entire OTP area, tapping anywhere in the cell
                  row opens the keyboard reliably.
                */}
                <TextInput
                  ref={inputRef}
                  style={styles.inputOverlay}
                  value={code}
                  onChangeText={(t) =>
                    setCode(t.replace(/\D/g, "").slice(0, CODE_LENGTH))
                  }
                  keyboardType="number-pad"
                  inputMode="numeric"
                  autoFocus
                  maxLength={CODE_LENGTH}
                  editable={!submitting}
                  textContentType="oneTimeCode"
                  caretHidden
                />
              </View>
            )}
          </Animated.View>

          {/* Resend / timer */}
          {!submitting && !verified && (
            <View style={styles.resendWrap}>
              {resendCooldown > 0 ? (
                <Text style={styles.resendTimer}>
                  Resend code in{" "}
                  <Text style={styles.resendTimerAccent}>
                    {resendCooldown}s
                  </Text>
                </Text>
              ) : (
                <Pressable onPress={onResend} accessibilityRole="button">
                  <Text style={styles.resendActive}>Resend Code</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Error */}
          {error && !submitting ? (
            <Text style={styles.error}>{error}</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing.xl,
  },
  stepLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.md,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    color: colors.light.text,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    marginTop: spacing.md,
    lineHeight: 21,
  },
  emailText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
    color: colors.light.text,
    marginTop: spacing.xs,
  },
  otpContainer: {
    marginTop: spacing["4xl"],
    alignItems: "center",
  },

  // The otpArea wraps both the visual cells and the invisible TextInput.
  // Its height is defined by the OTP cells; the TextInput fills it absolutely.
  otpArea: {
    alignSelf: "center",
  },
  otpCells: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
  otpCell: {
    width: dimensions.otpCell.width,
    height: dimensions.otpCell.height,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.md,
    backgroundColor: colors.light.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  otpCellFilled: {
    borderColor: colors.primary,
  },
  otpDigit: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.otpInput,
    color: colors.light.text,
  },

  // Invisible TextInput that covers the OTP cell row.
  // opacity 0.01 (not 0) because Android skips focus at exactly 0.
  inputOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    color: "transparent",
    fontSize: 22,
  },

  spinnerWrap: {
    paddingVertical: spacing.xl,
  },
  resendWrap: {
    alignItems: "center",
    marginTop: spacing["2xl"],
  },
  resendTimer: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.light.textMut,
  },
  resendTimerAccent: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  resendActive: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
    color: colors.primary,
    textDecorationLine: "underline",
  },
  error: {
    fontFamily: fonts.regular,
    textAlign: "center",
    color: colors.error,
    fontSize: fontSizes.caption,
    marginTop: spacing.md,
    fontWeight: "600",
  },

  // Verified state
  verifiedWrap: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  verifiedCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    borderWidth: borders.medium,
    borderColor: colors.primaryText,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    ...shadows.neu.light,
  },
  verifiedTick: {
    fontSize: 32,
    color: colors.primaryText,
    includeFontPadding: false,
    lineHeight: 32,
    textAlign: "center",
  },
  verifiedLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.md,
    color: colors.primary,
    letterSpacing: 2,
  },
});
