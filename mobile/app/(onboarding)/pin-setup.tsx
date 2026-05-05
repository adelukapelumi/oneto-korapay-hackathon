import { useRef, useState } from "react";
import {
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

const PIN_LENGTH = 6;
const PIN_REGEX = /^\d{6}$/;

type Step = "enter" | "confirm";

export default function PinSetupScreen(): React.ReactElement {
  const router = useRouter();
  const [step, setStep] = useState<Step>("enter");
  const [firstPin, setFirstPin] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const onChange = (raw: string): void => {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    setError(null);
    if (digits.length !== PIN_LENGTH) return;
    if (step === "enter") {
      if (!PIN_REGEX.test(digits)) {
        setError("Use 6 digits.");
        setPin("");
        return;
      }
      setFirstPin(digits);
      setPin("");
      setStep("confirm");
      // Re-focus so the user can keep typing without tapping.
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    // confirm step
    if (digits !== firstPin) {
      setError("PINs don't match. Try again.");
      setFirstPin("");
      setPin("");
      setStep("enter");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    // Both match. Hand off to the generating-keys screen, passing the
    // confirmed PIN as a route param. Generating-keys does the actual
    // keypair generation + secure-store write + key registration.
    router.replace({
      pathname: "/(onboarding)/generating-keys",
      params: { pin: digits },
    });
  };

  const heading =
    step === "enter" ? "Choose a 6-digit PIN" : "Confirm your PIN";
  const subheading =
    step === "enter"
      ? "You'll use this PIN to unlock the app."
      : "Type the same PIN again.";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.subtitle}>{subheading}</Text>

          <TextInput
            ref={inputRef}
            style={[styles.input, error ? styles.inputError : null]}
            value={pin}
            onChangeText={onChange}
            keyboardType="number-pad"
            inputMode="numeric"
            secureTextEntry
            autoFocus
            maxLength={PIN_LENGTH}
            placeholder="••••••"
            textContentType="oneTimeCode"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[
              styles.button,
              pin.length !== PIN_LENGTH && styles.buttonDisabled,
            ]}
            onPress={() => onChange(pin)}
            disabled={pin.length !== PIN_LENGTH}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>
              {step === "enter" ? "Continue" : "Confirm"}
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
});
