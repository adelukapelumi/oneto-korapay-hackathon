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

const PIN_LENGTH = 6;

export default function PinEntryScreen(): React.ReactElement {
  const { unlock, signOut } = useAuth();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // Refresh the visible state on mount and whenever the lock countdown
  // ticks. The countdown is presentational only — the canonical lock
  // boundary is enforced inside loadAndDecryptKeypair.
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

  const onChange = (raw: string): void => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length === PIN_LENGTH) {
      void submit(digits);
    }
  };

  async function submit(value: string): Promise<void> {
    if (submitting || lockSecondsRemaining > 0) return;
    setSubmitting(true);
    try {
      await unlock(value);
      // Successful unlock: layout will redirect to /home.
    } catch (err) {
      if (err instanceof PinLockedError) {
        const remaining = Math.max(
          0,
          Math.ceil((err.lockedUntilMs - Date.now()) / 1000),
        );
        setMessage(`Locked. Try again in ${formatMmSs(remaining)}.`);
        setLockSecondsRemaining(remaining);
        setPin("");
        return;
      }
      if (err instanceof PinIncorrectError) {
        const result = await recordWrongAttempt();
        if (result.willWipe) {
          // Belt-and-braces: keypair was already wiped inside
          // recordWrongAttempt; force a sign-out to flush the JWT
          // and bounce to email entry.
          await wipeKeypair();
          await signOut();
          return;
        }
        const state = await getAttemptState();
        const display = describeAttemptState(state);
        setMessage(display.message);
        setLockSecondsRemaining(display.lockSecondsRemaining);
        setPin("");
        inputRef.current?.focus();
        return;
      }
      logger.warn("PIN unlock unexpected error", err);
      setMessage("Something went wrong. Try again.");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  const isLocked = lockSecondsRemaining > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Enter your PIN</Text>
          <Text style={styles.subtitle}>
            Use the 6-digit PIN you set up on this device.
          </Text>

          <TextInput
            ref={inputRef}
            style={[styles.input, message ? styles.inputError : null]}
            value={pin}
            onChangeText={onChange}
            keyboardType="number-pad"
            inputMode="numeric"
            secureTextEntry
            autoFocus
            maxLength={PIN_LENGTH}
            placeholder="••••••"
            editable={!submitting && !isLocked}
            textContentType="oneTimeCode"
          />

          {message ? <Text style={styles.message}>{message}</Text> : null}

          <Pressable
            style={[
              styles.button,
              (submitting || pin.length !== PIN_LENGTH || isLocked) &&
                styles.buttonDisabled,
            ]}
            onPress={() => submit(pin)}
            disabled={submitting || pin.length !== PIN_LENGTH || isLocked}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Unlock</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={styles.signOutWrap}
          >
            <Text style={styles.signOutText}>Sign in with a different account</Text>
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
    height: 64,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    backgroundColor: "#fafafa",
  },
  inputError: { borderColor: "#c00" },
  message: { color: "#c00", marginTop: 12, fontSize: 14, textAlign: "center" },
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
  signOutWrap: { marginTop: 24, alignItems: "center" },
  signOutText: { color: "#0066cc", fontSize: 14, fontWeight: "500" },
});
