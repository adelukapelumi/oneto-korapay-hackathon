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

  const { control, handleSubmit, formState } = useForm<SignInForm>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: "" },
    mode: "onBlur",
  });

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
          <Text style={styles.title}>oneto</Text>
          <Text style={styles.subtitle}>
            Enter your email to receive a sign-in code.
          </Text>

          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <View style={styles.field}>
                <TextInput
                  style={[
                    styles.input,
                    fieldState.error ? styles.inputError : null,
                  ]}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  editable={!submitting}
                />
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

          <Pressable
            style={[
              styles.button,
              (submitting || !formState.isValid) && styles.buttonDisabled,
            ]}
            onPress={onSubmit}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Send code</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  title: { fontSize: 36, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#444", marginBottom: 32 },
  field: { marginBottom: 16 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  inputError: { borderColor: "#c00" },
  fieldError: { color: "#c00", marginTop: 6, fontSize: 14 },
  networkError: { color: "#c00", marginBottom: 12, fontSize: 14 },
  button: {
    height: 52,
    backgroundColor: "#000",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
