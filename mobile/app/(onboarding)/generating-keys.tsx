import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { generateKeypair } from "@oneto/shared";
import { saveKeypairUnderPin } from "../../src/crypto/pin-derive";
import { registerPublicKey, RotationSignatureRequiredError } from "../../src/api/keys";
import { NetworkError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/auth-state";
import { logger } from "../../src/lib/logger";

type Phase =
  | { kind: "working"; message: string }
  | { kind: "rotation_required" }
  | { kind: "error"; message: string };

export default function GeneratingKeysScreen(): React.ReactElement {
  const { completeOnboarding } = useAuth();
  const params = useLocalSearchParams<{ pin?: string }>();
  const pin = typeof params.pin === "string" ? params.pin : "";
  const [phase, setPhase] = useState<Phase>({
    kind: "working",
    message: "Generating keypair…",
  });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!pin || pin.length !== 6) {
      setPhase({ kind: "error", message: "Missing PIN. Go back and try again." });
      return;
    }

    void (async () => {
      try {
        // 1. Generate keypair (Ed25519 from @oneto/shared — never roll our own)
        setPhase({ kind: "working", message: "Generating keypair…" });
        const { privateKey, publicKey, publicKeyString } = generateKeypair();

        // 2. Encrypt with PIN-derived key and persist in secure-store
        setPhase({ kind: "working", message: "Securing PIN…" });
        await saveKeypairUnderPin(privateKey, publicKeyString, pin);

        // 3. Register public key with backend
        setPhase({ kind: "working", message: "Registering with oneto…" });
        await registerPublicKey(publicKeyString);

        // 4. Hand decrypted private key to the auth provider (in-memory ref).
        // publicKey isn't strictly needed by completeOnboarding but we
        // pass the bytes for symmetry with future signing API.
        completeOnboarding(privateKey, publicKeyString);
        // After this, _layout sees status=authed and redirects to /home.
      } catch (err) {
        if (err instanceof RotationSignatureRequiredError) {
          setPhase({ kind: "rotation_required" });
          return;
        }
        if (err instanceof NetworkError) {
          setPhase({
            kind: "error",
            message:
              "Couldn't reach oneto. Check your connection and try again.",
          });
          return;
        }
        logger.warn("Onboarding key registration failed", err);
        setPhase({
          kind: "error",
          message: "Something went wrong. Try again.",
        });
      }
    })();
  }, [pin, completeOnboarding]);

  if (phase.kind === "rotation_required") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.title}>We need to verify it's you</Text>
          <Text style={styles.body}>
            This account already has a key registered on another device. To
            set up oneto on this phone, please contact support so we can
            help you safely transfer.
          </Text>
          <View style={styles.contactBox}>
            <Text style={styles.contactLabel}>Email</Text>
            <Text style={styles.contactValue}>support@getoneto.com</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (phase.kind === "error") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.title}>Setup failed</Text>
          <Text style={styles.body}>{phase.message}</Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              startedRef.current = false;
              setPhase({ kind: "working", message: "Retrying…" });
            }}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text style={styles.workingMessage}>{phase.message}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  body: { fontSize: 16, color: "#444", lineHeight: 22, textAlign: "center", marginBottom: 24 },
  workingMessage: { fontSize: 16, color: "#444", marginTop: 16 },
  contactBox: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 16,
    width: "100%",
  },
  contactLabel: { color: "#666", fontSize: 12, marginBottom: 4 },
  contactValue: { color: "#000", fontSize: 18, fontWeight: "600" },
  button: {
    height: 52,
    backgroundColor: "#000",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
