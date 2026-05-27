import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import { fetchMe, requestOtp, verifyOtp } from "../../src/api/auth";
import { NetworkError, UnauthorizedError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/auth-state";
import {
  isAllowedRecoveryReauthEmail,
  RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE,
  sanitizeRecoveryReauthReturnTo,
} from "../../src/auth/recovery-reauth";
import { clearToken, setToken } from "../../src/auth/token-store";
import { logger } from "../../src/lib/logger";
import { BackButton } from "../../components/BackButton";
import { useCompactLayout } from "../../src/ui/responsive";
import { useThemeMode } from "../../src/theme/theme-provider";
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
} from "../../src/theme/tokens";

const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;

export default function VerifyScreen(): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const params = useLocalSearchParams<{ email?: string; returnTo?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const returnTo =
    typeof params.returnTo === "string"
      ? sanitizeRecoveryReauthReturnTo(params.returnTo)
      : null;
  const { signIn, state } = useAuth();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [verified, setVerified] = useState(false);
  const compact = useCompactLayout();

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
    const expectedRecoveryEmail =
      state.status === "recovery_pending" ||
      state.status === "onboarding" ||
      state.status === "locked" ||
      state.status === "authed"
        ? state.user.email
        : null;
    const expectedRecoveryUserId =
      state.status === "recovery_pending" ||
      state.status === "onboarding" ||
      state.status === "locked" ||
      state.status === "authed"
        ? state.user.id
        : null;
    if (
      !isAllowedRecoveryReauthEmail({
        recoveryReturnTo: returnTo,
        requestedEmail: email,
        expectedEmail: expectedRecoveryEmail,
      })
    ) {
      setError(RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { accessToken } = await verifyOtp(email, value);
      await setToken(accessToken);
      const me = await fetchMe();
      if (
        returnTo !== null &&
        expectedRecoveryUserId !== null &&
        me.id !== expectedRecoveryUserId
      ) {
        await clearToken();
        logger.warn("recovery_reauth_user_mismatch", {
          expectedUserId: expectedRecoveryUserId,
          actualUserId: me.id,
          expectedEmail: expectedRecoveryEmail,
          actualEmail: me.email,
        });
        setError(RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE);
        setCode("");
        return;
      }

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
      if (returnTo) {
        router.replace(returnTo);
      }
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
    const expectedRecoveryEmail =
      state.status === "recovery_pending" ||
      state.status === "onboarding" ||
      state.status === "locked" ||
      state.status === "authed"
        ? state.user.email
        : null;
    if (
      !isAllowedRecoveryReauthEmail({
        recoveryReturnTo: returnTo,
        requestedEmail: email,
        expectedEmail: expectedRecoveryEmail,
      })
    ) {
      setError(RECOVERY_REAUTH_EMAIL_MISMATCH_MESSAGE);
      return;
    }
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
    <Screen
      scroll
      keyboard
      contentContainerStyle={{ paddingBottom: spacing["2xl"] }}
    >
        {/* Header */}
        <View style={styles.header}>
          <BackButton />
        </View>

        <View
          style={[
            styles.container,
            {
              paddingHorizontal: compact.horizontalPadding,
              paddingTop: compact.topPadding,
            },
          ]}
        >
          <Text style={styles.stepLabel}>STEP 2</Text>
          <Text
            style={[
              styles.title,
              { color: t.text, fontSize: compact.isVeryShort ? fontSizes.h2 : fontSizes.h2Lg },
            ]}
          >
            Verify your email
          </Text>
          <Text style={[styles.subtitle, { color: t.textSec }]}>We sent a 6-digit code to</Text>
          <Text style={[styles.emailText, { color: t.text }]}>{email}</Text>

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
                <View style={[styles.verifiedCircle, t.shadow]}>
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
                <View
                  style={[
                    styles.otpCells,
                    { gap: compact.isVeryShort ? 6 : compact.isNarrow ? 8 : 10 },
                  ]}
                  pointerEvents="none"
                >
                  {Array.from({ length: CODE_LENGTH }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.otpCell,
                        {
                          width: compact.isVeryShort ? 42 : compact.isNarrow ? 44 : dimensions.otpCell.width,
                          height: compact.isVeryShort ? 50 : compact.isNarrow ? 52 : dimensions.otpCell.height,
                          borderColor: t.border,
                          backgroundColor: t.inputBg,
                        },
                        code[i] ? styles.otpCellFilled : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.otpDigit,
                          {
                            color: t.text,
                            fontSize: compact.isVeryShort ? 20 : fontSizes.otpInput,
                          },
                        ]}
                      >
                        {code[i] || ""}
                      </Text>
                    </View>
                  ))}
                </View>

                <TextInput
                  ref={inputRef}
                  style={styles.inputOverlay}
                  value={code}
                  onChangeText={(txt) =>
                    setCode(txt.replace(/\D/g, "").slice(0, CODE_LENGTH))
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
                <Text style={[styles.resendTimer, { color: t.textMut }]}>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
  },
  container: {
    alignItems: "center",
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
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    marginTop: spacing.md,
    lineHeight: 21,
    textAlign: "center",
  },
  emailText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  otpContainer: {
    marginTop: spacing["4xl"],
    alignItems: "center",
  },
  otpArea: {
    alignSelf: "center",
  },
  otpCells: {
    flexDirection: "row",
    justifyContent: "center",
  },
  otpCell: {
    width: dimensions.otpCell.width,
    height: dimensions.otpCell.height,
    borderWidth: borders.standard,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  otpCellFilled: {
    borderColor: colors.primary,
  },
  otpDigit: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.otpInput,
  },
  inputOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    fontSize: 22,
    ...Platform.select({
      android: { opacity: 0.01 },
      ios: { color: "transparent" },
    }),
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
