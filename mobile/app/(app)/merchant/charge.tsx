import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { createPaymentRequest } from "../../../src/payment/create-request";
import { MAX_OFFLINE_TRANSACTION_KOBO } from "@oneto/shared";

export default function ChargeScreen() {
  const [amountStr, setAmountStr] = useState("");
  const { state } = useAuth();
  const router = useRouter();

  if (state.status !== "authed") return null;

  const handleGenerate = async () => {
    const amountNaira = parseFloat(amountStr);
    if (isNaN(amountNaira) || amountNaira <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid amount.");
      return;
    }

    const amountKobo = Math.round(amountNaira * 100);

    if (amountKobo > MAX_OFFLINE_TRANSACTION_KOBO) {
      Alert.alert("Amount Too High", `Maximum offline transaction is ₦${MAX_OFFLINE_TRANSACTION_KOBO / 100}.`);
      return;
    }

    const request = await createPaymentRequest(state.user.id, amountKobo, state.user.email);
    
    router.push({
      pathname: "/(app)/merchant/request-qr",
      params: { requestJson: JSON.stringify(request) }
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.label}>Enter Amount (₦)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={amountStr}
          onChangeText={setAmountStr}
          placeholder="0.00"
          autoFocus
        />

        <Pressable style={styles.button} onPress={handleGenerate}>
          <Text style={styles.buttonText}>Generate QR</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  label: { fontSize: 16, color: "#666", marginBottom: 8, textAlign: "center" },
  input: {
    fontSize: 48,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 32,
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    paddingBottom: 8,
  },
  button: {
    backgroundColor: "#000",
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
