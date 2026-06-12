import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Screen } from "../../components/Screen";
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
import { useCompactLayout } from "../../src/ui/responsive";
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
  const { unlock, signOut, resetLocalAppForTesting } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode); // reactive theme object — updates when user toggles

  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isResettingLocalApp, setIsResettingLocalApp] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const compact = useCompactLayout();

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
    if (pin.length >= PIN_LENGTH || submitting || isResettingLocalApp || lockSecondsRemaining > 0) return;
    onChange(pin + String(d));
  }

  function onDelete(): void {
    if (submitting || isResettingLocalApp || lockSecondsRemaining > 0) return;
    setPin((p) => p.slice(0, -1));
    setMessage(null);
  }

  async function submit(value: string): Promise<void> {
    if (submitting || isResettingLocalApp || lockSecondsRemaining > 0) return;
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

  async function performFullLocalReset(): Promise<void> {
    if (submitting || isResettingLocalApp) {
      return;
    }

    setIsResettingLocalApp(true);
    try {
      await resetLocalAppForTesting();
      Alert.alert(
        "Local app reset",
        "This device's local keypair and local app state were wiped for testing.",
      );
    } catch {
      Alert.alert(
        "Reset failed",
        "Couldn't wipe this device's local state. Close and reopen the app, then try again.",
      );
    } finally {
      setIsResettingLocalApp(false);
    }
  }

  function confirmFullLocalReset(): void {
    if (submitting || isResettingLocalApp) {
      return;
    }

    Alert.alert(
      "TESTING ONLY",
      "This wipes the local keypair and local app data on this device only. It does not change the backend account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe this device",
          style: "destructive",
          onPress: () => {
            void performFullLocalReset();
          },
        },
      ],
    );
  }

  const isLocked = lockSecondsRemaining > 0;
  const controlsDisabled = submitting || isResettingLocalApp;

  return (
    <Screen scroll contentContainerStyle={{ paddingBottom: spacing["2xl"] }}>
      <View
        style={[
          styles.container,
          {
            paddingHorizontal: compact.horizontalPadding,
            paddingTop: compact.topPadding,
          },
        ]}
      >
        {/* Brand */}
        <View
          style={[
            styles.brandSection,
            { marginTop: compact.isVeryShort ? spacing.xl : spacing["4xl"] },
          ]}
        >
          <Text
            style={[
              styles.logoText,
              { color: t.text, fontSize: compact.isVeryShort ? 36 : 42 },
            ]}
          >
            oneto
          </Text>
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
        <View
          style={[
            styles.welcomeSection,
            { marginTop: compact.isVeryShort ? spacing["2xl"] : spacing["5xl"] },
          ]}
        >
          <Text style={[styles.welcomeTitle, { color: t.text }]}>
            Welcome back
          </Text>
          <Text style={[styles.welcomeSubtitle, { color: t.textSec }]}>
            Enter your PIN to continue
          </Text>
        </View>

        {/* PIN dots */}
        <Animated.View
          style={[
            styles.dotsRow,
            {
              gap: compact.pinDotGap,
              marginTop: compact.isVeryShort ? spacing["2xl"] : spacing["4xl"],
            },
            { transform: [{ translateX: shakeAnim }] },
          ]}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  width: compact.isVeryShort ? 18 : dimensions.pinDot.size,
                  height: compact.isVeryShort ? 18 : dimensions.pinDot.size,
                  borderRadius: compact.isVeryShort ? 9 : dimensions.pinDot.size / 2,
                  borderColor: t.border,
                },
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
        {(submitting || isResettingLocalApp) && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: t.textSec }]}>
              {isResettingLocalApp ? "Resetting this app..." : "Unlocking..."}
            </Text>
          </View>
        )}

        {/* Numpad */}
        {!controlsDisabled && (
          <View style={[styles.numPad, { gap: compact.numPadRowGap }]}>
            {NUM_ROWS.map((row, ri) => (
              <View key={ri} style={[styles.numRow, { gap: compact.numPadColGap }]}>
                {row.map((key, ki) => {
                  if (key === "") {
                    return (
                      <View
                        key={ki}
                        style={[
                          styles.numKeyEmpty,
                          {
                            width: compact.numPadKeySize,
                            height: compact.numPadKeySize,
                          },
                        ]}
                      />
                    );
                  }
                  const disabled = isLocked || controlsDisabled;
                  return (
                    <Pressable
                      key={ki}
                      style={({ pressed }) => [
                        styles.numKey,
                        {
                          width: compact.numPadKeySize,
                          height: compact.numPadKeySize,
                          borderRadius: compact.numPadKeySize / 2,
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
                          {
                            color: t.text,
                            fontSize: compact.isVeryShort ? 22 : fontSizes.numPad,
                          },
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

        <Pressable
          style={({ pressed }) => [
            styles.testingResetButton,
            { borderColor: colors.error, backgroundColor: colors.error + "14" },
            pressed && !controlsDisabled && styles.testingResetButtonPressed,
            controlsDisabled && styles.testingResetButtonDisabled,
          ]}
          onPress={confirmFullLocalReset}
          disabled={controlsDisabled}
          accessibilityRole="button"
        >
          <Text style={styles.testingResetEyebrow}>TESTING ONLY</Text>
          <Text style={styles.testingResetTitle}>Wipe keypair and local app state</Text>
          <Text style={styles.testingResetBody}>
            Clears this device&apos;s local keypair, PIN attempt state, cached profile, token, and local
            storage for testing.
          </Text>
          <Text style={styles.testingResetAction}>
            {isResettingLocalApp ? "Resetting this app..." : "Tap to wipe this device"}
          </Text>
        </Pressable>

        {/* Footer */}
        {/* <View style={styles.footer}>
          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={styles.signOutButton}
          >
            <Text style={styles.signOutText}>
              Sign in with a different account
            </Text>
          </Pressable>
        </View> */}

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
    </Screen>
  );
}

// Only static values live in StyleSheet. Theme-dependent colors are applied
// inline above so they react to mode changes without a full remount.
const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },

  brandSection: { alignItems: "center" },
  logoText: { fontFamily: fonts.bold, fontSize: 42, letterSpacing: -1 },
  pixelDots: { flexDirection: "row", gap: 4, marginTop: spacing.sm },
  pixelDot: { width: 6, height: 6 },

  welcomeSection: { alignItems: "center" },
  welcomeTitle: { fontFamily: fonts.bold, fontSize: fontSizes.h1 },
  welcomeSubtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    marginTop: spacing.sm,
  },

  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  dot: {
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
    alignItems: "center",
  },
  numRow: { flexDirection: "row" },
  numKey: {
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
  numKeyEmpty: {},
  numKeyText: { fontFamily: fonts.semibold, fontSize: fontSizes.numPad },

  testingResetButton: {
    marginTop: spacing["2xl"],
    borderRadius: radii.xl,
    borderWidth: borders.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
    width: "100%",
  },
  testingResetButtonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
  },
  testingResetButtonDisabled: {
    opacity: 0.7,
  },
  testingResetEyebrow: {
    fontFamily: fonts.pixel,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },
  testingResetTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
    color: colors.error,
    textAlign: "center",
  },
  testingResetBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.error,
    textAlign: "center",
    lineHeight: 22,
  },
  testingResetAction: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },

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
