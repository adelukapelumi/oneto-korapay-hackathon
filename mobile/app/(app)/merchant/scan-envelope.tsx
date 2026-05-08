import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { verifyEnvelopeLocally } from "../../../src/payment/verify-local";
import { insertPendingTransaction } from "../../../src/ledger/db";
import { useAuth } from "../../../src/auth/auth-state";
import type { PaymentRequest } from "@oneto/shared";

export default function ScanEnvelopeScreen() {
  const { requestJson } = useLocalSearchParams<{ requestJson: string }>();
  const router = useRouter();
  const { state } = useAuth();
  
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (permission && !permission.granted) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (state.status !== "authed") return null;
  if (!requestJson) return null;

  const originalRequest = JSON.parse(requestJson) as PaymentRequest;

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setScanned(true);

    try {
      const parsedData = JSON.parse(data);
      const verifyResult = verifyEnvelopeLocally(parsedData);

      if (!verifyResult.ok) {
        // Show generic error without leaking info
        Alert.alert("Invalid Payment", "The payment could not be verified.", [
          { text: "Try Again", onPress: () => setScanned(false) }
        ]);
        return;
      }

      const envelope = verifyResult.envelope;

      // Three-way match
      if (
        envelope.requestNonce !== originalRequest.requestNonce ||
        envelope.recipientUserId !== state.user.id ||
        envelope.amountKobo !== originalRequest.amountKobo
      ) {
        Alert.alert("Invalid Payment", "This payment does not match the request.", [
          { text: "Try Again", onPress: () => setScanned(false) }
        ]);
        return;
      }

      // Valid! Store it
      insertPendingTransaction({
        id: envelope.transactionId,
        envelopeJson: JSON.stringify(envelope),
        recipientId: state.user.id,
        recipientLabel: undefined,
        amountKobo: envelope.amountKobo,
        sequenceNumber: envelope.senderSequenceNumber,
        direction: "incoming",
        createdAt: new Date().toISOString(),
      });

      router.replace({
        pathname: "/(app)/merchant/success",
        params: { senderUserId: envelope.senderUserId, amountKobo: String(envelope.amountKobo) }
      });

    } catch (e) {
      Alert.alert("Invalid QR", "Could not parse payment data.", [
        { text: "Try Again", onPress: () => setScanned(false) }
      ]);
    }
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.text}>Requesting camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.instruction}>Scan the customer's response</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  text: { color: "#fff" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  header: {
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  instruction: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
  },
});
