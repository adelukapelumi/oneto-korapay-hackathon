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
import { useThemeMode } from "../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
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
  const { mode } = useThemeMode();
  const t = getTheme(mode); // reactive theme object — updates when user toggles

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
    const id = setInterval(() => void refresh(), 1000);
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
    <SafeAreaView
      style={[styles.safe, { backgroundColor: t.bg }]}
      edges={["top", "bottom"]}
    >
      <View style={styles.container}>
        {/* Brand */}
        <View style={styles.brandSection}>
          <Text style={[styles.logoText, { color: t.text }]}>oneto</Text>
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

        {/* Welcome */}
        <View style={styles.welcomeSection}>
          <Text style={[styles.welcomeTitle, { color: t.text }]}>
            Welcome back
          </Text>
          <Text style={[styles.welcomeSubtitle, { color: t.textSec }]}>
            Enter your PIN to continue
          </Text>
        </View>

        {/* PIN dots */}
        <Animated.View
          style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}
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

        {/* Error / lock message */}
        {message ? (
          <View style={styles.messageContainer}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : (
          <View style={styles.messageSpacer} />
        )}

        {/* Submitting */}
        {submitting && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: t.textSec }]}>
              Unlocking...
            </Text>
          </View>
        )}

        {/* Numpad */}
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
                        {
                          borderColor: t.border,
                          backgroundColor: t.keyBg,
                        },
                        pressed && !disabled && styles.numKeyPressed,
                        disabled && styles.numKeyDisabled,
                      ]}
                      onPress={() =>
                        key === "del" ? onDelete() : onDigit(key as number)
                      }
                      disabled={disabled}
                    >
                      <Text
                        style={[
                          styles.numKeyText,
                          { color: t.text },
                          disabled && { color: t.textMut },
                        ]}
                      >
                        {key === "del" ? "⌫" : key}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={styles.signOutButton}
          >
            <Text style={styles.signOutText}>
              Sign in with a different account
            </Text>
          </Pressable>
        </View>

        {/* Hidden input */}
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
          showSoftInputOnFocus={false}
        />
      </View>
    </SafeAreaView>
  );
}

// Only static values live in StyleSheet. Theme-dependent colors are applied
// inline above so they react to mode changes without a full remount.
const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    alignItems: "center",
  },

  brandSection: { alignItems: "center", marginTop: spacing["4xl"] },
  logoText: { fontFamily: fonts.bold, fontSize: 42, letterSpacing: -1 },
  pixelDots: { flexDirection: "row", gap: 4, marginTop: spacing.sm },
  pixelDot: { width: 6, height: 6 },

  welcomeSection: { alignItems: "center", marginTop: spacing["5xl"] },
  welcomeTitle: { fontFamily: fonts.bold, fontSize: fontSizes.h1 },
  welcomeSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    marginTop: spacing.sm,
  },

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
  messageSpacer: { height: 48, marginTop: spacing.lg },

  loadingOverlay: {
    alignItems: "center",
    marginTop: spacing["3xl"],
    gap: spacing.md,
  },
  loadingText: { fontFamily: fonts.medium, fontSize: fontSizes.body },

  numPad: {
    marginTop: spacing.xl,
    gap: dimensions.numPadGap.row,
    alignItems: "center",
  },
  numRow: { flexDirection: "row", gap: dimensions.numPadGap.col },
  numKey: {
    width: dimensions.numPadKey.size,
    height: dimensions.numPadKey.size,
    borderRadius: dimensions.numPadKey.size / 2,
    borderWidth: borders.medium,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  numKeyPressed: { transform: [{ scale: 0.9 }] },
  numKeyDisabled: { opacity: 0.4 },
  numKeyEmpty: {
    width: dimensions.numPadKey.size,
    height: dimensions.numPadKey.size,
  },
  numKeyText: { fontFamily: fonts.semibold, fontSize: fontSizes.numPad },

  footer: { marginTop: "auto", paddingBottom: spacing["2xl"] },
  signOutButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  signOutText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: colors.primary,
  },

  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
});
