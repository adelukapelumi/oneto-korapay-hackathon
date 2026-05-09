import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { fetchMe } from "../../../src/api/auth";
import { setLocalState } from "../../../src/ledger/db";
import { logger } from "../../../src/lib/logger";
import { BackButton } from "../../../components/BackButton";
import {
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  shadows,
  dimensions,
} from "../../../src/theme/tokens";

type PaymentStatus = "idle" | "success" | "failed";

// JavaScript injected into the Korapay checkout WebView. It watches the
// page content for success indicators via MutationObserver + a periodic
// fallback. When detected, it sends a postMessage to React Native.
// This approach works WITHOUT a redirect_url in the backend payload.
const KORAPAY_SUCCESS_DETECTOR = `
(function() {
  var sent = false;
  function check() {
    if (sent) return;
    var text = (document.body && document.body.innerText) || '';
    var lower = text.toLowerCase();
    if (
      lower.includes('payment successful') ||
      lower.includes('transaction successful') ||
      lower.includes('payment completed') ||
      lower.includes('completed successfully')
    ) {
      sent = true;
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'korapay_success' })
      );
    }
  }
  // MutationObserver for instant detection when Korapay updates the DOM.
  if (typeof MutationObserver !== 'undefined' && document.body) {
    var obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  // Periodic fallback every 2 seconds in case MutationObserver misses it.
  var interval = setInterval(function() {
    check();
    if (sent) clearInterval(interval);
  }, 2000);
})();
true;
`;

export default function CheckoutScreen(): React.ReactElement {
  const router = useRouter();
  const { paymentUrl, reference } = useLocalSearchParams<{
    paymentUrl: string;
    reference: string;
  }>();

  const [isLoading, setIsLoading] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle");

  function handleSuccess(): void {
    if (paymentStatus !== "idle") return; // prevent double-fire
    setPaymentStatus("success");
    fetchMe()
      .then((user) => {
        setLocalState("verified_balance_kobo", user.verifiedBalanceKobo);
        setLocalState("last_sync_at", new Date().toISOString());
      })
      .catch((err) => {
        logger.warn("Balance refresh after success failed", err);
      });
  }

  function onWebViewMessage(event: WebViewMessageEvent): void {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string };
      if (data.type === "korapay_success") {
        handleSuccess();
      }
    } catch {
      // Ignore non-JSON messages from the WebView.
    }
  }

  if (!paymentUrl) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Missing Payment URL</Text>
          <Text style={styles.errorText}>
            Could not load the payment page. Please try again.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.errorButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.back()}
          >
            <Text style={styles.errorButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>Complete Top Up</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Reference badge */}
      {reference ? (
        <View style={styles.referenceBadge}>
          <Text style={styles.referenceText}>Ref: {reference}</Text>
        </View>
      ) : null}

      {/* WebView */}
      <View style={styles.webviewContainer}>
        <WebView
          source={{ uri: paymentUrl }}
          style={styles.webview}
          startInLoadingState={false}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          injectedJavaScript={KORAPAY_SUCCESS_DETECTOR}
          onMessage={onWebViewMessage}
          onShouldStartLoadWithRequest={(request) => {
            // Backup: if the backend ever adds a redirect_url, detect it here.
            if (request.url.startsWith("https://oneto.return/")) {
              handleSuccess();
              return false;
            }
            return true;
          }}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
        />
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading payment...</Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Complete your payment securely via Korapay
        </Text>
      </View>

      {/* Success Modal */}
      <Modal visible={paymentStatus === "success"} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.pixelRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[styles.pixel, i % 2 === 0 && styles.pixelFilled]} />
              ))}
            </View>
            <View style={styles.successIconWrap}>
              <Text style={styles.modalIconText}>✓</Text>
            </View>
            <Text style={styles.modalLabel}>TOP UP SUCCESSFUL</Text>
            <Text style={styles.modalBody}>Your balance has been updated</Text>
            {reference ? (
              <View style={styles.refBadge}>
                <Text style={styles.refText}>Ref: {reference}</Text>
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.modalButton, pressed && styles.buttonPressed]}
              onPress={() => router.replace("/(app)/home")}
              accessibilityRole="button"
            >
              <Text style={styles.modalButtonText}>Back to Dashboard</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Failed Modal */}
      <Modal visible={paymentStatus === "failed"} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.successIconWrap, styles.failedIconWrap]}>
              <Text style={styles.modalIconText}>✕</Text>
            </View>
            <Text style={[styles.modalLabel, styles.failedLabel]}>PAYMENT FAILED</Text>
            <Text style={styles.modalBody}>Something went wrong. Please try again.</Text>
            <Pressable
              style={({ pressed }) => [styles.modalButton, styles.failedButton, pressed && styles.buttonPressed]}
              onPress={() => router.back()}
              accessibilityRole="button"
            >
              <Text style={[styles.modalButtonText, styles.failedButtonText]}>Go Back</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.md, minHeight: dimensions.headerMinHeight, gap: spacing.md, backgroundColor: colors.light.bg },
  headerTitle: { flex: 1, fontFamily: fonts.bold, fontSize: fontSizes.headerTitle, color: colors.light.text },
  headerSpacer: { width: dimensions.headerBackButton.size },
  referenceBadge: { marginHorizontal: spacing.xl, marginBottom: spacing.sm, alignSelf: "flex-start", backgroundColor: colors.light.cardAlt, borderRadius: radii.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  referenceText: { fontFamily: fonts.medium, fontSize: fontSizes.xs, color: colors.light.textMut },
  webviewContainer: { flex: 1, marginHorizontal: spacing.md, marginBottom: spacing.md, borderRadius: radii.lg, borderWidth: borders.medium, borderColor: colors.light.border, overflow: "hidden", backgroundColor: "#fff" },
  webview: { flex: 1, backgroundColor: "#fff" },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.light.bg, alignItems: "center", justifyContent: "center" },
  loadingCard: { alignItems: "center", gap: spacing.lg },
  loadingText: { fontFamily: fonts.medium, fontSize: fontSizes.body, color: colors.light.textSec },
  footer: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, alignItems: "center" },
  footerText: { fontFamily: fonts.regular, fontSize: fontSizes.sm, color: colors.light.textMut },
  errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.screenHorizontal },
  errorIcon: { fontSize: 48, marginBottom: spacing.lg },
  errorTitle: { fontFamily: fonts.bold, fontSize: fontSizes.h3, color: colors.light.text, marginBottom: spacing.sm },
  errorText: { fontFamily: fonts.regular, fontSize: fontSizes.body, color: colors.light.textSec, textAlign: "center", marginBottom: spacing["2xl"] },
  errorButton: { paddingHorizontal: spacing["2xl"], paddingVertical: spacing.md, backgroundColor: colors.light.card, borderRadius: radii.pill, borderWidth: borders.standard, borderColor: colors.light.border },
  errorButtonText: { fontFamily: fonts.semibold, fontSize: fontSizes.button, color: colors.light.text },
  modalOverlay: { flex: 1, backgroundColor: colors.light.overlay, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  modalCard: { width: "100%", backgroundColor: colors.light.card, borderRadius: radii.xl, borderWidth: borders.standard, borderColor: colors.light.border, padding: spacing["2xl"], alignItems: "center", gap: spacing.md, ...shadows.neu.light },
  pixelRow: { flexDirection: "row", gap: 4, marginBottom: spacing.xs },
  pixel: { width: 8, height: 8, backgroundColor: "transparent" },
  pixelFilled: { backgroundColor: colors.primary },
  successIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, borderWidth: borders.medium, borderColor: colors.primaryText, alignItems: "center", justifyContent: "center", ...shadows.neu.light },
  failedIconWrap: { backgroundColor: colors.error, borderColor: colors.error },
  modalIconText: { fontSize: 32, color: colors.primaryText, includeFontPadding: false, lineHeight: 32, textAlign: "center" },
  modalLabel: { fontFamily: fonts.pixel, fontSize: pixelFontSizes.sm, color: colors.primary, letterSpacing: 1, textAlign: "center" },
  failedLabel: { color: colors.error },
  modalBody: { fontFamily: fonts.regular, fontSize: fontSizes.body, color: colors.light.textSec, textAlign: "center" },
  refBadge: { backgroundColor: colors.light.cardAlt, borderRadius: radii.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  refText: { fontFamily: fonts.medium, fontSize: fontSizes.xs, color: colors.light.textMut },
  modalButton: { width: "100%", height: 52, backgroundColor: colors.primary, borderRadius: radii.pill, borderWidth: borders.standard, borderColor: colors.primaryText, alignItems: "center", justifyContent: "center", marginTop: spacing.sm, ...shadows.neu.light },
  failedButton: { backgroundColor: colors.light.card, borderColor: colors.light.border },
  modalButtonText: { fontFamily: fonts.bold, fontSize: fontSizes.button, color: colors.primaryText },
  failedButtonText: { color: colors.light.text },
  buttonPressed: { transform: [{ translateX: 3 }, { translateY: 3 }], shadowOffset: { width: 0, height: 0 } },
});
