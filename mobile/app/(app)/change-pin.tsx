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
import {
  PinIncorrectError,
  PinLockedError,
  changePinAndReencrypt,
} from "../../src/crypto/pin-derive";
import { logger } from "../../src/lib/logger";

const PIN_LENGTH = 6;
const PIN_REGEX = /^\d{6}$/;

export default function ChangePinScreen(): React.ReactElement {
  const router = useRouter();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onlyDigits = (raw: string): string =>
    raw.replace(/\D/g, "").slice(0, PIN_LENGTH);

  async function onSubmit(): Promise<void> {
    setError(null);
    if (!PIN_REGEX.test(currentPin)) {
      setError("Current PIN must be 6 digits.");
      return;
    }
    if (!PIN_REGEX.test(newPin)) {
      setError("New PIN must be 6 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("New PINs don't match.");
      return;
    }
    if (newPin === currentPin) {
      setError("New PIN must differ from current.");
      return;
    }
    setSubmitting(true);
    try {
      await changePinAndReencrypt(currentPin, newPin);
      setSuccess(true);
      // Pop back to home after a brief confirmation.
      setTimeout(() => router.back(), 1200);
    } catch (err) {
      if (err instanceof PinIncorrectError) {
        setError("Current PIN is incorrect.");
      } else if (err instanceof PinLockedError) {
        setError("Too many wrong attempts. Try again later.");
      } else {
        logger.warn("changePinAndReencrypt unexpected error", err);
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Change PIN</Text>

          <Text style={styles.label}>Current PIN</Text>
          <TextInput
            style={styles.input}
            value={currentPin}
            onChangeText={(t) => setCurrentPin(onlyDigits(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_LENGTH}
            placeholder="••••••"
            editable={!submitting && !success}
            textContentType="oneTimeCode"
          />

          <Text style={styles.label}>New PIN</Text>
          <TextInput
            style={styles.input}
            value={newPin}
            onChangeText={(t) => setNewPin(onlyDigits(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_LENGTH}
            placeholder="••••••"
            editable={!submitting && !success}
          />

          <Text style={styles.label}>Confirm new PIN</Text>
          <TextInput
            style={styles.input}
            value={confirmPin}
            onChangeText={(t) => setConfirmPin(onlyDigits(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_LENGTH}
            placeholder="••••••"
            editable={!submitting && !success}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {success ? <Text style={styles.success}>PIN changed.</Text> : null}

          <Pressable
            style={[
              styles.button,
              (submitting || success) && styles.buttonDisabled,
            ]}
            onPress={() => void onSubmit()}
            disabled={submitting || success}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            style={styles.cancelWrap}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  container: { flex: 1, padding: 24 },
  title: { fontSize: 24, fontWeight: "700", marginVertical: 24 },
  label: { fontSize: 13, color: "#666", marginBottom: 6, marginTop: 12 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 22,
    letterSpacing: 8,
    textAlign: "center",
    backgroundColor: "#fafafa",
  },
  error: { color: "#c00", marginTop: 16, fontSize: 14 },
  success: { color: "#0a0", marginTop: 16, fontSize: 14 },
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
  cancelWrap: { marginTop: 16, alignItems: "center" },
  cancelText: { color: "#0066cc", fontSize: 14, fontWeight: "500" },
});
