import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  PinIncorrectError,
  PinLockedError,
  getAttemptState,
  recordWrongAttempt,
  wipeKeypair,
} from "../../src/crypto/pin-derive";
import { describeAttemptState, formatMmSs } from "../../src/lib/pin-attempts";
import { useAuth } from "../../src/auth/auth-state";
import { logger } from "../../src/lib/logger";
import {
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
  shadows,
  dimensions,
} from "../../src/theme/tokens";

const PIN_LENGTH = 6;

const NUM_ROWS: (number | "del" | "")[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  ["", 0, "del"],
];

export default function PinEntryScreen(): React.ReactElement {
  const { unlock, signOut } = useAuth();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const state = await getAttemptState();
      if (cancelled) return;
      const display = describeAttemptState(state);
      setMessage(display.message);
      setLockSecondsRemaining(display.lockSecondsRemaining);
    };
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function triggerShake(): void {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  const onChange = (raw: string): void => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    setMessage(null);
    if (digits.length === PIN_LENGTH) {
      void submit(digits);
    }
  };

  function onDigit(d: number): void {
    if (pin.length >= PIN_LENGTH || submitting || lockSecondsRemaining > 0) return;
    onChange(pin + String(d));
  }

  function onDelete(): void {
    if (submitting || lockSecondsRemaining > 0) return;
    setPin((p) => p.slice(0, -1));
    setMessage(null);
  }

  async function submit(value: string): Promise<void> {
    if (submitting || lockSecondsRemaining > 0) return;
    setSubmitting(true);
    try {
      await unlock(value);
    } catch (err) {
      if (err instanceof PinLockedError) {
        const remaining = Math.max(
          0,
          Math.ceil((err.lockedUntilMs - Date.now()) / 1000),
        );
        setMessage(`Locked. Try again in ${formatMmSs(remaining)}.`);
        setLockSecondsRemaining(remaining);
        triggerShake();
        setPin("");
        return;
      }
      if (err instanceof PinIncorrectError) {
        const result = await recordWrongAttempt();
        if (result.willWipe) {
          await wipeKeypair();
          await signOut();
          return;
        }
        const state = await getAttemptState();
        const display = describeAttemptState(state);
        setMessage(display.message);
        setLockSecondsRemaining(display.lockSecondsRemaining);
        triggerShake();
        setPin("");
        inputRef.current?.focus();
        return;
      }
      logger.warn("PIN unlock unexpected error", err);
      setMessage("Something went wrong. Try again.");
      triggerShake();
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  const isLocked = lockSecondsRemaining > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        {/* Logo / Brand */}
        <View style={styles.brandSection}>
          <Text style={styles.logoText}>oneto</Text>
          <View style={styles.pixelDots}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={[
                  styles.pixelDot,
                  { backgroundColor: i % 2 === 0 ? colors.primary : colors.secondary },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Welcome Text */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeTitle}>Welcome back</Text>
          <Text style={styles.welcomeSubtitle}>Enter your PIN to continue</Text>
        </View>

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

        {/* Error / Lock Message */}
        {message ? (
          <View style={styles.messageContainer}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : (
          <View style={styles.messageSpacer} />
        )}

        {/* Loading indicator when submitting */}
        {submitting && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Unlocking...</Text>
          </View>
        )}

        {/* NumPad */}
        {!submitting && (
          <View style={styles.numPad}>
            {NUM_ROWS.map((row, ri) => (
              <View key={ri} style={styles.numRow}>
                {row.map((key, ki) => {
                  if (key === "") {
                    return <View key={ki} style={styles.numKeyEmpty} />;
                  }
                  const disabled = isLocked;
                  return (
                    <Pressable
                      key={ki}
                      style={({ pressed }) => [
                        styles.numKey,
                        pressed && !disabled && styles.numKeyPressed,
                        disabled && styles.numKeyDisabled,
                      ]}
                      onPress={() =>
                        key === "del" ? onDelete() : onDigit(key as number)
                      }
                      disabled={disabled}
                    >
                      <Text style={[styles.numKeyText, disabled && styles.numKeyTextDisabled]}>
                        {key === "del" ? "⌫" : key}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* Sign out link */}
        <View style={styles.footer}>
          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={styles.signOutButton}
          >
            <Text style={styles.signOutText}>Sign in with a different account</Text>
          </Pressable>
        </View>

        {/* Hidden TextInput for accessibility / autofill */}
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={pin}
          onChangeText={onChange}
          keyboardType="number-pad"
          inputMode="numeric"
          secureTextEntry
          maxLength={PIN_LENGTH}
          textContentType="oneTimeCode"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.dark.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    alignItems: "center",
  },

  // Brand Section
  brandSection: {
    alignItems: "center",
    marginTop: spacing["4xl"],
  },
  logoText: {
    fontFamily: fonts.bold,
    fontSize: 42,
    color: colors.dark.text,
    letterSpacing: -1,
  },
  pixelDots: {
    flexDirection: "row",
    gap: 4,
    marginTop: spacing.sm,
  },
  pixelDot: {
    width: 6,
    height: 6,
  },

  // Welcome Section
  welcomeSection: {
    alignItems: "center",
    marginTop: spacing["5xl"],
  },
  welcomeTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h1,
    color: colors.dark.text,
  },
  welcomeSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.dark.textSec,
    marginTop: spacing.sm,
  },

  // PIN Dots
  dotsRow: {
    flexDirection: "row",
    gap: dimensions.pinDot.gap,
    justifyContent: "center",
    marginTop: spacing["4xl"],
  },
  dot: {
    width: dimensions.pinDot.size,
    height: dimensions.pinDot.size,
    borderRadius: dimensions.pinDot.size / 2,
    borderWidth: borders.standard,
    borderColor: colors.dark.border,
    backgroundColor: "transparent",
  },
  dotFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    transform: [{ scale: 1.15 }],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },

  // Message
  messageContainer: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.error + "20",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.error + "40",
  },
  messageText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },
  messageSpacer: {
    height: 48,
    marginTop: spacing.lg,
  },

  // Loading
  loadingOverlay: {
    alignItems: "center",
    marginTop: spacing["3xl"],
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: colors.dark.textSec,
  },

  // NumPad
  numPad: {
    marginTop: spacing.xl,
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
    borderColor: colors.dark.border,
    backgroundColor: colors.dark.keyBg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  numKeyPressed: {
    transform: [{ scale: 0.9 }],
    backgroundColor: colors.dark.cardAlt,
  },
  numKeyDisabled: {
    opacity: 0.4,
  },
  numKeyEmpty: {
    width: dimensions.numPadKey.size,
    height: dimensions.numPadKey.size,
  },
  numKeyText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.numPad,
    color: colors.dark.text,
  },
  numKeyTextDisabled: {
    color: colors.dark.textMut,
  },

  // Footer
  footer: {
    marginTop: "auto",
    paddingBottom: spacing["2xl"],
  },
  signOutButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  signOutText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: colors.primary,
  },

  // Hidden input
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },
});
