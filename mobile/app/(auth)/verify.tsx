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
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Tick the cooldown down each second. Initial cooldown matches the
  // implicit "we just sent a code" state from the previous screen.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  // Auto-submit when the user types the 6th digit. The button stays for
  // accessibility users on screen readers.
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
      // Persist the token first so the request interceptor can attach it to
      // the immediate /me call below. signIn() persists again (idempotent)
      // and updates auth state — the (auth) layout then redirects to /home.
      await setToken(accessToken);
      const me = await fetchMe();
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
      inputRef.current?.focus();
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
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header with back button */}
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        </View>

        <View style={styles.container}>
          {/* Step indicator */}
          <Text style={styles.stepLabel}>STEP 2</Text>

          {/* Heading */}
          <Text style={styles.title}>Verify your email</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>We sent a 6-digit code to</Text>
          <Text style={styles.emailText}>{email}</Text>

          {/* OTP cells display */}
          <Animated.View
            style={[
              styles.otpContainer,
              { transform: [{ translateX: shakeAnim }] },
            ]}
          >
            {submitting ? (
              <View style={styles.spinnerWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <Pressable
                style={styles.otpCells}
                onPress={() => inputRef.current?.focus()}
              >
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
              </Pressable>
            )}

            {/* Hidden input that captures keyboard */}
            <TextInput
              ref={inputRef}
              style={styles.hiddenInput}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              editable={!submitting}
              textContentType="oneTimeCode"
              caretHidden
            />
          </Animated.View>

          {/* Resend / timer */}
          {!submitting && (
            <View style={styles.resendWrap}>
              {resendCooldown > 0 ? (
                <Text style={styles.resendTimer}>
                  Resend code in{" "}
                  <Text style={styles.resendTimerAccent}>{resendCooldown}s</Text>
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
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
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
});
