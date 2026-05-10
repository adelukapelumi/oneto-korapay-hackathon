import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { createPaymentRequest } from "../../../src/payment/create-request";
import { MAX_OFFLINE_TRANSACTION_KOBO } from "@oneto/shared";
import { BackButton } from "../../../components/BackButton";
import { useThemeMode } from "../../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
  dimensions,
} from "../../../src/theme/tokens";

export default function ChargeScreen() {
  const [amountStr, setAmountStr] = useState("");
  const { state } = useAuth();
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Charge Customer</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.container}>
        <Text style={[styles.label, { color: t.textSec }]}>Enter Amount (₦)</Text>
        <TextInput
          style={[styles.input, { color: t.text, borderBottomColor: t.border }]}
          keyboardType="numeric"
          value={amountStr}
          onChangeText={setAmountStr}
          placeholder="0.00"
          placeholderTextColor={t.textMut}
          autoFocus
        />

        <Pressable
          style={({ pressed }) => [
            styles.button,
            { borderColor: t.border },
            t.shadow,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleGenerate}
        >
          <Text style={styles.buttonText}>Generate QR</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
  },
  headerSpacer: { width: dimensions.headerBackButton.size },
  container: { flex: 1, paddingHorizontal: spacing.screenHorizontal, justifyContent: "center" },
  label: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  input: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h1,
    textAlign: "center",
    marginBottom: spacing["2xl"],
    borderBottomWidth: borders.thin,
    paddingBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
