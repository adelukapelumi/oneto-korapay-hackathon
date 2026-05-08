import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { requestTopup, MIN_TOPUP_KOBO, MAX_TOPUP_KOBO } from "../../../src/payment/topup-flow";
import { TopupAmountError } from "../../../src/payment/topup-flow";
import { ApiError } from "../../../src/api/errors";

export default function TopupAmountScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const [amountStr, setAmountStr] = useState("");
  const [loading, setLoading] = useState(false);

  const jwtFresh = state.status === "authed" && state.jwtFresh;

  if (!jwtFresh) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950 p-6">
        <Text className="text-zinc-400 text-lg text-center">
          Sign in to top up your balance.
        </Text>
      </View>
    );
  }

  const handleTopup = async () => {
    const amountNgn = parseFloat(amountStr);
    if (isNaN(amountNgn)) {
      Alert.alert("Invalid Amount", "Please enter a valid number");
      return;
    }

    const amountKobo = Math.round(amountNgn * 100);
    setLoading(true);
    try {
      const res = await requestTopup(amountKobo);
      router.push({
        pathname: "/(app)/topup/checkout",
        params: { paymentUrl: res.paymentUrl, reference: res.reference },
      });
    } catch (err) {
      if (err instanceof TopupAmountError) {
        Alert.alert("Invalid Amount", err.message);
      } else if (err instanceof ApiError) {
        Alert.alert("Error", err.message);
      } else if (err instanceof Error) {
        Alert.alert("Error", err.message);
      } else {
        Alert.alert("Error", "An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-zinc-950 p-6">
      <Text className="text-3xl font-semibold text-white mb-6 mt-12">Top Up Balance</Text>
      
      <View className="mb-6">
        <Text className="text-zinc-400 mb-2">Amount (₦)</Text>
        <TextInput
          className="bg-zinc-900 text-white p-4 rounded-xl text-2xl font-semibold border border-zinc-800"
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor="#52525b"
          value={amountStr}
          onChangeText={setAmountStr}
          editable={!loading}
        />
        <View className="flex-row justify-between mt-2">
          <Text className="text-zinc-500 text-sm">Min: ₦{MIN_TOPUP_KOBO / 100}</Text>
          <Text className="text-zinc-500 text-sm">Max: ₦{(MAX_TOPUP_KOBO / 100).toLocaleString()}</Text>
        </View>
      </View>

      <Pressable
        className={`bg-indigo-600 p-4 rounded-xl items-center flex-row justify-center ${loading ? 'opacity-70' : 'active:bg-indigo-700'}`}
        onPress={handleTopup}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" className="mr-2" />
        ) : null}
        <Text className="text-white font-semibold text-lg">Top Up</Text>
      </Pressable>
    </View>
  );
}
