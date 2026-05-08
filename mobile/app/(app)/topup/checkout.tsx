import { useEffect, useRef } from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { WebView } from "react-native-webview";
import { fetchMe } from "../../../src/api/auth";
import { setLocalState } from "../../../src/ledger/db";
import { logger } from "../../../src/lib/logger";

export default function CheckoutScreen() {
  const router = useRouter();
  const { paymentUrl, reference } = useLocalSearchParams<{ paymentUrl: string; reference: string }>();

  // Use a ref to ensure we only refresh once when unmounting/closing
  const hasRefreshed = useRef(false);

  useEffect(() => {
    return () => {
      // Refresh user balance on close
      if (!hasRefreshed.current) {
        hasRefreshed.current = true;
        fetchMe()
          .then((user) => {
            setLocalState("verified_balance_kobo", user.verifiedBalanceKobo);
            setLocalState("last_sync_at", new Date().toISOString());
            logger.info("Refreshed user balance after checkout");
          })
          .catch((err) => {
            logger.error("Failed to refresh user after checkout", err);
          });
      }
    };
  }, []);

  if (!paymentUrl) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950">
        <ActivityIndicator color="white" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-zinc-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Complete Top Up",
          headerStyle: { backgroundColor: "#09090b" },
          headerTintColor: "#fff",
        }}
      />
      <WebView
        source={{ uri: paymentUrl }}
        style={{ flex: 1, backgroundColor: "#09090b" }}
        startInLoadingState={true}
        renderLoading={() => (
          <View className="absolute inset-0 items-center justify-center bg-zinc-950">
            <ActivityIndicator color="white" size="large" />
          </View>
        )}
      />
    </View>
  );
}
