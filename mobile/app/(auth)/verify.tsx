import { useEffect, useRef, useState } from "react";
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
import { useLocalSearchParams } from "expo-router";
import { fetchMe, requestOtp, verifyOtp } from "../../src/api/auth";
import { NetworkError, UnauthorizedError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/auth-state";
import { setToken } from "../../src/auth/token-store";
import { logger } from "../../src/lib/logger";

const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const { signIn } = useAuth();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<TextInput>(null);

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
        <View style={styles.container}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to {email || "your inbox"}.
          </Text>

          <TextInput
            ref={inputRef}
            style={[styles.input, error ? styles.inputError : null]}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            placeholder="123456"
            editable={!submitting}
            textContentType="oneTimeCode"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[
              styles.button,
              (submitting || code.length !== 6) && styles.buttonDisabled,
            ]}
            onPress={() => submit(code)}
            disabled={submitting || code.length !== 6}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </Pressable>

          <Pressable
            onPress={onResend}
            disabled={resendCooldown > 0 || submitting}
            accessibilityRole="button"
            style={styles.resendWrap}
          >
            <Text
              style={[
                styles.resendText,
                resendCooldown > 0 ? styles.resendDisabled : null,
              ]}
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Resend code"}
            </Text>
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
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#444", marginBottom: 32 },
  input: {
    height: 56,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 24,
    letterSpacing: 6,
    textAlign: "center",
    backgroundColor: "#fafafa",
  },
  inputError: { borderColor: "#c00" },
  error: { color: "#c00", marginTop: 12, fontSize: 14 },
  button: {
    height: 52,
    backgroundColor: "#000",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  resendWrap: { marginTop: 24, alignItems: "center" },
  resendText: { color: "#0066cc", fontSize: 14, fontWeight: "500" },
  resendDisabled: { color: "#999" },
});
