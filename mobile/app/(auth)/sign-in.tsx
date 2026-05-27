import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Screen } from "../../components/Screen";
import { requestOtp } from "../../src/api/auth";
import { NetworkError } from "../../src/api/errors";
import { logger } from "../../src/lib/logger";
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
} from "../../src/theme/tokens";

const SignInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .email("That doesn't look like a valid email"),
});

type SignInForm = z.infer<typeof SignInSchema>;

export default function SignInScreen(): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const compact = useCompactLayout();

  const emailInputRef = useRef<TextInput>(null);

  const { control, handleSubmit, formState, watch } = useForm<SignInForm>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: "" },
    mode: "onBlur",
  });

  const emailValue = watch("email");
  const isCU = emailValue.toLowerCase().endsWith("@stu.cu.edu.ng");

  const onSubmit = handleSubmit(async ({ email }) => {
    setNetworkError(null);
    setSubmitting(true);
    try {
      await requestOtp(email);
    } catch (err) {
      if (err instanceof NetworkError) {
        setNetworkError(err.message);
        setSubmitting(false);
        return;
      }
      logger.info("requestOtp non-network error; navigating to verify anyway");
    }
    router.push({ pathname: "/(auth)/verify", params: { email } });
    setSubmitting(false);
  });

  return (
    <Screen
      scroll
      keyboard
      contentContainerStyle={[
        styles.container,
        {
          paddingHorizontal: compact.horizontalPadding,
          paddingTop: compact.topPadding,
          paddingBottom: spacing["2xl"],
        },
      ]}
    >
      <View style={styles.container}>
          {/* Step indicator */}
          <Text style={styles.stepLabel}>STEP 1</Text>

          {/* Heading */}
          <Text
            style={[
              styles.title,
              {
                color: t.text,
                fontSize: compact.isVeryShort ? fontSizes.h2Lg : fontSizes.h1,
                lineHeight: compact.isVeryShort ? 32 : 37,
              },
            ]}
          >
            Get started{"\n"}with{" "}
            <Text style={styles.titleAccent}>Oneto</Text>
          </Text>

          {/* Subtitle */}
          <Text style={[styles.subtitle, { color: t.textSec }]}>
            Enter your CU email or pre-registered merchant email to get started with offline payments.
          </Text>

          {/* Email input */}
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <View style={styles.field}>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: t.inputBg, borderColor: t.border },
                    focused && styles.inputWrapFocused,
                    fieldState.error && styles.inputWrapError,
                  ]}
                >
                  <Text style={styles.inputIcon}>✉️</Text>
                  <TextInput
                    ref={emailInputRef}
                    style={[styles.input, { color: t.text }]}
                    placeholder="you@stu.cu.edu.ng"
                    placeholderTextColor={t.textMut}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    autoFocus
                    value={field.value}
                    onChangeText={field.onChange}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                      setFocused(false);
                      field.onBlur();
                    }}
                    editable={!submitting}
                  />
                  {isCU && (
                    <View style={styles.cuBadge}>
                      <Text style={styles.cuBadgeText}>✓ CU</Text>
                    </View>
                  )}
                </View>
                {fieldState.error ? (
                  <Text style={styles.fieldError}>
                    {fieldState.error.message}
                  </Text>
                ) : null}
              </View>
            )}
          />

          {networkError ? (
            <Text style={styles.networkError}>{networkError}</Text>
          ) : null}

          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { height: compact.buttonHeight, borderColor: t.border },
                t.shadow,
                (submitting || !formState.isValid) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={onSubmit}
              disabled={submitting}
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </Pressable>

            <Text style={[styles.terms, { color: t.textMut }]}>
              By continuing, you agree to our Terms of Service
            </Text>
          </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stepLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.md,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h1,
    lineHeight: 37,
  },
  titleAccent: {
    color: colors.primary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLg,
    marginTop: spacing.md,
    lineHeight: 22,
  },
  field: {
    marginTop: spacing["4xl"],
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: borders.standard,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  inputWrapFocused: {
    borderColor: colors.primary,
  },
  inputWrapError: {
    borderColor: colors.error,
  },
  inputIcon: {
    fontSize: 18,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: fontSizes.input,
    padding: 0,
  },
  cuBadge: {
    backgroundColor: "rgba(32,230,152,0.13)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  cuBadgeText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
    color: colors.primary,
  },
  fieldError: {
    fontFamily: fonts.regular,
    color: colors.error,
    marginTop: 6,
    fontSize: fontSizes.caption,
  },
  networkError: {
    fontFamily: fonts.regular,
    color: colors.error,
    marginTop: spacing.md,
    fontSize: fontSizes.body,
  },
  footer: {
    marginTop: "auto",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  terms: {
    fontFamily: fonts.regular,
    textAlign: "center",
    fontSize: fontSizes.caption,
    marginTop: spacing.lg,
  },
});
