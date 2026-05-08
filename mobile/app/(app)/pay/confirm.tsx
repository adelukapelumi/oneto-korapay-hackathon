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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import {
  PinIncorrectError,
  PinLockedError,
  unlockKeypairWithPin,
} from "../../../src/crypto/pin-derive";
import { insertPendingTransaction } from "../../../src/ledger/db";
import {
  buildAndSignEnvelope,
  InsufficientBalanceError,
} from "../../../src/payment/build-envelope";
import { logger } from "../../../src/lib/logger";
import { PaymentRequest } from "@oneto/shared";

const PIN_LENGTH = 6;
const PIN_REGEX = /^\d{6}$/;

export default function ConfirmPaymentScreen(): React.ReactElement | null {
  const router = useRouter();
  const { request } = useLocalSearchParams<{ request: string }>();
  const { state } = useAuth();

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (state.status !== "authed" && state.status !== "locked") {
    // Should not be reachable due to (app) layout auth gate
    return null;
  }
  const user = state.user;

  let paymentRequest: PaymentRequest | null = null;
  try {
    if (request) {
      paymentRequest = JSON.parse(request);
    }
  } catch (e) {
    // Invalid JSON param
  }

  if (!paymentRequest) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Invalid payment request.</Text>
        <Pressable onPress={() => router.back()} style={styles.cancelWrap}>
          <Text style={styles.cancelText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // Format amount as Naira (Kobo / 100)
  const amountNaira = (paymentRequest.amountKobo / 100).toFixed(2);

  const onlyDigits = (raw: string): string =>
    raw.replace(/\D/g, "").slice(0, PIN_LENGTH);

  async function onSubmit(): Promise<void> {
    setError(null);
    if (!PIN_REGEX.test(pin)) {
      setError("PIN must be 6 digits.");
      return;
    }

    setSubmitting(true);

    try {
      // 1. Decrypt keypair (validates PIN)
      const { privateKey, publicKey } = await unlockKeypairWithPin(pin);

      try {
        // 2. Build and sign envelope
        const envelope = buildAndSignEnvelope({
          paymentRequest: paymentRequest!,
          senderUserId: user.id,
          senderPublicKey: publicKey,
          privateKey,
        });

        // 3. Persist to SQLite ledger
        insertPendingTransaction({
          id: envelope.transactionId,
          envelopeJson: JSON.stringify(envelope),
          recipientId: envelope.recipientUserId,
          recipientLabel: paymentRequest!.merchantLabel,
          amountKobo: envelope.amountKobo,
          sequenceNumber: envelope.senderSequenceNumber,
          direction: "outgoing",
          createdAt: envelope.timestamp,
        });

        // 4. Navigate to display screen
        router.replace({
          pathname: "/(app)/pay/display",
          params: { envelope: JSON.stringify(envelope) },
        });
      } finally {
        // Zero the private key in memory immediately, regardless of success/failure
        privateKey.fill(0);
      }
    } catch (err) {

      if (err instanceof PinIncorrectError) {
        setError("Incorrect PIN.");
      } else if (err instanceof PinLockedError) {
        setError("Too many wrong attempts. Try again later.");
      } else if (err instanceof InsufficientBalanceError) {
        setError(`Insufficient balance. (Available: ₦${(err.available / 100).toFixed(2)})`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        logger.warn("Confirm payment unexpected error", String(err));
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
      setPin(""); // Clear PIN on error
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.merchantText}>
            Paying: {paymentRequest.merchantLabel || paymentRequest.merchantId}
          </Text>
          <Text style={styles.amountText}>₦{amountNaira}</Text>

          <Text style={styles.label}>Enter PIN to confirm</Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={(t) => setPin(onlyDigits(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={PIN_LENGTH}
            placeholder="••••••"
            editable={!submitting}
            textContentType="oneTimeCode"
            autoFocus
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={() => void onSubmit()}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Confirm & Pay</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            style={styles.cancelWrap}
            disabled={submitting}
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
  container: { flex: 1, padding: 24, justifyContent: "center" },
  merchantText: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 8 },
  amountText: { fontSize: 42, fontWeight: "800", textAlign: "center", marginBottom: 40 },
  label: { fontSize: 13, color: "#666", marginBottom: 6 },
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
  error: { color: "#c00", marginTop: 16, fontSize: 14, textAlign: "center" },
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
  cancelWrap: { marginTop: 24, alignItems: "center" },
  cancelText: { color: "#0066cc", fontSize: 14, fontWeight: "500" },
});
