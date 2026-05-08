import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { requestOtp } from "../../src/api/auth";
import { NetworkError } from "../../src/api/errors";
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
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);

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
      // Server-side rejections (rate limit, malformed email post-validation)
      // are intentionally silent — matches the backend's anti-enumeration
      // posture. We still navigate to /verify so attackers can't tell whether
      // an email is registered.
      logger.info("requestOtp non-network error; navigating to verify anyway");
    }
    router.push({ pathname: "/(auth)/verify", params: { email } });
    setSubmitting(false);
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          {/* Step indicator */}
          <Text style={styles.stepLabel}>STEP 1</Text>

          {/* Heading */}
          <Text style={styles.title}>
            Get started{"\n"}with{" "}
            <Text style={styles.titleAccent}>oneto</Text>
          </Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Enter your CU email to get started with offline payments.
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
                    focused && styles.inputWrapFocused,
                    fieldState.error && styles.inputWrapError,
                  ]}
                >
                  <Text style={styles.inputIcon}>✉️</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="you@stu.cu.edu.ng"
                    placeholderTextColor={colors.dark.textMut}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
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

          {/* Spacer pushes button to bottom */}
          <View style={styles.flex} />

          {/* Continue button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
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

          {/* Terms */}
          <Text style={styles.terms}>
            By continuing, you agree to our Terms of Service
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.bg },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing["6xl"],
    paddingBottom: spacing["2xl"],
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
    color: colors.light.text,
    lineHeight: 37,
  },
  titleAccent: {
    color: colors.primary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.bodyLg,
    color: colors.light.textSec,
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
    backgroundColor: colors.light.inputBg,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
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
    color: colors.light.text,
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
  button: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
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
    color: colors.light.textMut,
    fontSize: fontSizes.caption,
    marginTop: spacing.lg,
  },
});
