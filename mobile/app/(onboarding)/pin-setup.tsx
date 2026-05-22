import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import { setPendingOnboardingPin } from "../../src/auth/onboarding-pin-memory";
import { useThemeMode } from "../../src/theme/theme-provider";
import { useCompactLayout } from "../../src/ui/responsive";
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
} from "@/theme/tokens";

import { BackButton } from "../../components/BackButton";

const PIN_LENGTH = 6;
const PIN_REGEX = /^\d{6}$/;

type Step = "enter" | "confirm";

const NUM_ROWS: (number | "del" | "")[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  ["", 0, "del"],
];

export default function PinSetupScreen(): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const compact = useCompactLayout();
  const [step, setStep] = useState<Step>("enter");
  const [firstPin, setFirstPin] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Runs whenever `pin` changes. This is the single place that decides
  // what to do when a full PIN has been entered, whether the digit came
  // from the numpad (onDigit) or the hidden TextInput (onChange).
  // Keeping logic here avoids the double-fire bug where onDigit → setPin
  // caused the TextInput's onChangeText to re-run onChange with the same
  // complete PIN, triggering router.replace twice.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;

    if (step === "enter") {
      setFirstPin(pin);
      setPin("");
      setStep("confirm");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    // confirm step
    if (pin !== firstPin) {
      triggerShake();
      setError("PINs don't match. Try again.");
      setFirstPin("");
      setPin("");
      setStep("enter");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    // Both steps passed. Keep the PIN out of route params/history/dev tooling.
    setPendingOnboardingPin(pin);
    router.replace("/(onboarding)/generating-keys");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // AFTER — onChange is now only responsible for sanitising raw TextInput input
  const onChange = (raw: string): void => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    setError(null);
  };

  function triggerShake(): void {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  function onDigit(d: number): void {
    if (pin.length >= PIN_LENGTH) return;
    setPin((p) => p + String(d));
    setError(null);
  }

  function onDelete(): void {
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  return (
    <Screen scroll contentContainerStyle={{ paddingBottom: spacing["2xl"] }}>
      {/* Header with back button */}
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
        {/* Step indicator */}
        <Text style={styles.stepLabel}>
          {step === "enter" ? "STEP 3" : "CONFIRM"}
        </Text>

        {/* Heading */}
        <Text style={[styles.title, { color: t.text }]}>
          {step === "enter" ? "Create your PIN" : "Enter PIN again"}
        </Text>

        {/* Subtitle */}
        <Text style={[styles.subtitle, { color: t.textSec }]}>
          {step === "enter"
            ? "This 6-digit PIN secures your payments"
            : "Re-enter your 6-digit PIN to confirm"}
        </Text>

        {/* PIN dots */}
        <Animated.View
          style={[
            styles.dotsRow,
            {
              gap: compact.pinDotGap,
              marginTop: compact.isVeryShort ? 24 : 48,
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

        {/* Error message */}
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.errorSpacer} />
        )}

        {/* NumPad */}
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
                      pressed && styles.numKeyPressed,
                    ]}
                    onPress={() =>
                      key === "del" ? onDelete() : onDigit(key as number)
                    }
                  >
                    <Text
                      style={[
                        styles.numKeyText,
                        {
                          color: t.text,
                          fontSize: compact.isVeryShort ? 22 : fontSizes.numPad,
                        },
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

        {/* Hint */}
        <Text
          style={[
            styles.hint,
            { color: t.textMut, marginTop: compact.isVeryShort ? spacing.lg : spacing["2xl"] },
          ]}
        >
          {step === "enter" ? "Don't share your PIN with anyone" : ""}
        </Text>

        {/* Hidden TextInput for OS autofill / accessibility */}
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
    fontSize: fontSizes.h2,
  },
  subtitle: {
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
  },
  errorSpacer: {
    height: 32,
    marginTop: spacing.md,
  },
  numPad: {
    marginTop: spacing.lg,
    alignItems: "center",
  },
  numRow: {
    flexDirection: "row",
  },
  numKey: {
    borderWidth: borders.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  numKeyPressed: {
    transform: [{ scale: 0.9 }],
  },
  numKeyEmpty: {},
  numKeyText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.numPad,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: spacing["2xl"],
    textAlign: "center",
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },
});
