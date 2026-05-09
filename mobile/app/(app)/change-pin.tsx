import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  PinIncorrectError,
  PinLockedError,
  changePinAndReencrypt,
} from "../../src/crypto/pin-derive";
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

const PIN_LENGTH = 6;

type Step = "current" | "new" | "confirm";

const STEP_CONFIG: Record<Step, { label: string; title: string; subtitle: string; indicator: string }> = {
  current: {
    label: "STEP 1",
    title: "Current PIN",
    subtitle: "Enter your existing 6-digit PIN",
    indicator: "1 of 3",
  },
  new: {
    label: "STEP 2",
    title: "New PIN",
    subtitle: "Choose a new 6-digit PIN",
    indicator: "2 of 3",
  },
  confirm: {
    label: "STEP 3",
    title: "Confirm PIN",
    subtitle: "Re-enter your new PIN to confirm",
    indicator: "3 of 3",
  },
};

const NUM_ROWS: (number | "del" | "")[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  ["", 0, "del"],
];

export default function ChangePinScreen(): React.ReactElement {
  const router = useRouter();

  const [step, setStep] = useState<Step>("current");
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;

  // Drive PIN completion from a useEffect so the numpad and the hidden
  // TextInput both go through the same path (avoids double-fire).
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;

    if (step === "current") {
      setCurrentPin(pin);
      setPin("");
      setStep("new");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    if (step === "new") {
      if (pin === currentPin) {
        shake();
        setError("New PIN must differ from your current one.");
        setPin("");
        return;
      }
      setNewPin(pin);
      setPin("");
      setStep("confirm");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    // confirm step
    if (pin !== newPin) {
      shake();
      setError("PINs don't match. Start over.");
      setPin("");
      setCurrentPin("");
      setNewPin("");
      setStep("current");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    // All three match — attempt the re-encryption.
    void attemptChange(currentPin, newPin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function attemptChange(current: string, next: string): Promise<void> {
    setError(null);
    try {
      await changePinAndReencrypt(current, next);
      setSuccess(true);
      Animated.spring(successScale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 120,
        friction: 8,
      }).start();
      setTimeout(() => router.back(), 1500);
    } catch (err) {
      if (err instanceof PinIncorrectError) {
        shake();
        setError("Current PIN was incorrect. Start over.");
      } else if (err instanceof PinLockedError) {
        setError("Too many wrong attempts. Try again later.");
      } else {
        logger.warn("changePinAndReencrypt unexpected error", err);
        setError("Something went wrong. Try again.");
      }
      setPin("");
      setCurrentPin("");
      setNewPin("");
      setStep("current");
    }
  }

  function shake(): void {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  function onDigit(d: number): void {
    if (pin.length >= PIN_LENGTH || success) return;
    setPin((p) => p + String(d));
    setError(null);
  }

  function onDelete(): void {
    if (success) return;
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  const config = STEP_CONFIG[step];

  // ── Success overlay ─────────────────────────────────────────────────────
  if (success) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.successContainer}>
          <Animated.View
            style={[
              styles.successContent,
              { transform: [{ scale: successScale }], opacity: successScale },
            ]}
          >
            <View style={styles.successCircle}>
              <Text style={styles.successTick}>✓</Text>
            </View>
            <Text style={styles.successLabel}>PIN CHANGED</Text>
            <Text style={styles.successBody}>Your new PIN is active.</Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        {/* Step progress pills */}
        <View style={styles.progressPills}>
          {(["current", "new", "confirm"] as Step[]).map((s) => (
            <View
              key={s}
              style={[
                styles.pill,
                s === step
                  ? styles.pillActive
                  : (step === "new" && s === "current") ||
                    (step === "confirm" && (s === "current" || s === "new"))
                    ? styles.pillDone
                    : styles.pillInactive,
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.container}>
        {/* Step label */}
        <Text style={styles.stepLabel}>{config.label}</Text>

        {/* Title */}
        <Text style={styles.title}>{config.title}</Text>

        {/* Subtitle */}
        <Text style={styles.subtitle}>{config.subtitle}</Text>

        {/* PIN dots */}
        <Animated.View
          style={[
            styles.dotsRow,
            { transform: [{ translateX: shakeAnim }] },
          ]}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i < pin.length && styles.dotFilled]}
            />
          ))}
        </Animated.View>

        {/* Error */}
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.errorSpacer} />
        )}

        {/* Numpad */}
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

        {/* Hidden input for accessibility */}
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={pin}
          onChangeText={(raw) => {
            setPin(raw.replace(/\D/g, "").slice(0, PIN_LENGTH));
            setError(null);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          secureTextEntry
          maxLength={PIN_LENGTH}
          showSoftInputOnFocus={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  progressPills: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
  },
  pill: {
    height: 4,
    flex: 1,
    borderRadius: radii.full,
  },
  pillActive: { backgroundColor: colors.primary },
  pillDone: { backgroundColor: colors.primary + "60" },
  pillInactive: { backgroundColor: colors.light.border + "60" },

  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing.xl,
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
    fontSize: fontSizes.h2,
    color: colors.light.text,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    marginTop: spacing.sm,
    textAlign: "center",
  },

  dotsRow: {
    flexDirection: "row",
    gap: dimensions.pinDot.gap,
    justifyContent: "center",
    marginTop: spacing["5xl"],
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

  error: {
    fontFamily: fonts.regular,
    color: colors.error,
    fontSize: fontSizes.caption,
    fontWeight: "600",
    marginTop: spacing.md,
    height: 32,
    textAlign: "center",
  },
  errorSpacer: { height: 32, marginTop: spacing.md },

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
  numKeyPressed: { transform: [{ scale: 0.9 }] },
  numKeyEmpty: {
    width: dimensions.numPadKey.size,
    height: dimensions.numPadKey.size,
  },
  numKeyText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.numPad,
    color: colors.light.text,
  },

  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },

  // Success
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  successContent: {
    alignItems: "center",
    gap: spacing.md,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    borderWidth: borders.medium,
    borderColor: colors.primaryText,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  successTick: {
    fontSize: 32,
    color: colors.primaryText,
    includeFontPadding: false,
    lineHeight: 32,
    textAlign: "center",
  },
  successLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.md,
    color: colors.primary,
    letterSpacing: 2,
    marginTop: spacing.sm,
  },
  successBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
  },
});
