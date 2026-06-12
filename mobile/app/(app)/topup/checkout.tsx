import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { fetchMe } from "../../../src/api/auth";
import { persistMeProfile } from "../../../src/auth/profile-cache";
import { useAuth } from "../../../src/auth/auth-state";
import { fetchTopupStatus, type TopupStatusResponse } from "../../../src/api/topup";
import { logger } from "../../../src/lib/logger";
import {
  resolveCheckoutStatusState,
  TOPUP_WEBVIEW_LOAD_ERROR_MESSAGE,
  type CheckoutPaymentStatus,
} from "../../../src/payment/topup-checkout-state";
import { BackButton } from "../../../components/BackButton";
import { useThemeMode } from "../../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  dimensions,
} from "../../../src/theme/tokens";

export default function CheckoutScreen(): React.ReactElement {
  const router = useRouter();
  const { paymentUrl, reference } = useLocalSearchParams<{
    paymentUrl: string;
    reference: string;
  }>();
  const { hydrateProfile } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<CheckoutPaymentStatus>("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Payment was not confirmed. No balance was added.",
  );
  const [webViewErrorMessage, setWebViewErrorMessage] = useState<string | null>(null);

  async function syncConfirmedBalance(): Promise<void> {
    try {
      const user = await fetchMe();
      hydrateProfile(user);
      persistMeProfile(user);
    } catch (err) {
      logger.warn("Failed to refresh balance after confirmed top-up", err);
    }
  }

  async function applyTopupStatus(topup: TopupStatusResponse): Promise<void> {
    const resolvedState = resolveCheckoutStatusState(topup);
    setStatusMessage(resolvedState.statusMessage);
    setPaymentStatus(resolvedState.paymentStatus);

    if (resolvedState.shouldSyncBalance) {
      await syncConfirmedBalance();
    }
  }

  async function checkTopupStatus(): Promise<void> {
    if (!reference || paymentStatus === "success" || isCheckingStatus) {
      return;
    }

    setIsCheckingStatus(true);
    try {
      const topup = await fetchTopupStatus(reference);
      await applyTopupStatus(topup);
    } catch (err) {
      logger.warn("Failed to fetch top-up status", err);
      Alert.alert(
        "Unable to Check Status",
        "We could not confirm this payment right now. Please try again in a moment.",
      );
    } finally {
      setIsCheckingStatus(false);
    }
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      void checkTopupStatus();
      return true;
    });

    return () => subscription.remove();
  }, [isCheckingStatus, paymentStatus, reference]);

  if (!paymentUrl || !reference) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={[styles.errorTitle, { color: t.text }]}>Missing Checkout Details</Text>
          <Text style={[styles.errorText, { color: t.textSec }]}>
            Could not load the payment session safely. Please start the top-up again.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.errorButton,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.back()}
          >
            <Text style={[styles.errorButtonText, { color: t.text }]}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={[styles.header, { backgroundColor: t.bg }]}>
        <BackButton onPress={() => void checkTopupStatus()} />
        <Text style={[styles.headerTitle, { color: t.text }]}>Complete Top Up</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.referenceBadge, { backgroundColor: t.cardAlt }]}>
        <Text style={[styles.referenceText, { color: t.textMut }]}>Ref: {reference}</Text>
      </View>

      <View style={[styles.webviewContainer, { borderColor: t.border }]}>
        {webViewErrorMessage ? (
          <View style={[styles.webviewErrorContainer, { backgroundColor: t.bg }]}>
            <Text style={[styles.webviewErrorTitle, { color: t.text }]}>Payment Page Unavailable</Text>
            <Text style={[styles.webviewErrorText, { color: t.textSec }]}>
              {webViewErrorMessage}
            </Text>
          </View>
        ) : (
          <WebView
            source={{ uri: paymentUrl }}
            style={styles.webview}
            startInLoadingState={false}
            onLoadStart={() => {
              setIsLoading(true);
              setWebViewErrorMessage(null);
            }}
            onLoadEnd={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setWebViewErrorMessage(TOPUP_WEBVIEW_LOAD_ERROR_MESSAGE);
            }}
            onHttpError={() => {
              setIsLoading(false);
              setWebViewErrorMessage(TOPUP_WEBVIEW_LOAD_ERROR_MESSAGE);
            }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
          />
        )}
        {isLoading && !webViewErrorMessage ? (
          <View style={[styles.loadingOverlay, { backgroundColor: t.bg }]}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: t.textSec }]}>Loading payment...</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: t.textMut }]}>
          Complete your payment securely via Korapay
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.statusButton,
            { backgroundColor: t.card, borderColor: t.border },
            t.shadow,
            pressed && styles.buttonPressed,
            isCheckingStatus && styles.buttonDisabled,
          ]}
          onPress={() => void checkTopupStatus()}
          disabled={isCheckingStatus}
        >
          {isCheckingStatus ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.statusButtonText, { color: t.text }]}>I&apos;ve paid — check status</Text>
          )}
        </Pressable>
      </View>

      <Modal visible={paymentStatus === "success"} transparent animationType="fade" statusBarTranslucent>
        <View style={[styles.modalOverlay, { backgroundColor: t.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
            <View style={styles.pixelRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[styles.pixel, i % 2 === 0 && styles.pixelFilled]} />
              ))}
            </View>
            <View style={[styles.successIconWrap, t.shadow]}>
              <Text style={styles.modalIconText}>✓</Text>
            </View>
            <Text style={styles.modalLabel}>TOP UP SUCCESSFUL</Text>
            <Text style={[styles.modalBody, { color: t.textSec }]}>{statusMessage}</Text>
            <View style={[styles.refBadge, { backgroundColor: t.cardAlt }]}>
              <Text style={[styles.refText, { color: t.textMut }]}>Ref: {reference}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.modalButton, t.shadow, pressed && styles.buttonPressed]}
              onPress={() => router.replace("/(app)/home")}
              accessibilityRole="button"
            >
              <Text style={styles.modalButtonText}>Back to Dashboard</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={paymentStatus === "pending"} transparent animationType="fade" statusBarTranslucent>
        <View style={[styles.modalOverlay, { backgroundColor: t.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
            <View style={[styles.pendingIconWrap, t.shadow]}>
              <ActivityIndicator size="large" color={colors.primaryText} />
            </View>
            <Text style={styles.modalLabel}>PAYMENT PENDING</Text>
            <Text style={[styles.modalBody, { color: t.textSec }]}>{statusMessage}</Text>
            <View style={[styles.refBadge, { backgroundColor: t.cardAlt }]}>
              <Text style={[styles.refText, { color: t.textMut }]}>Ref: {reference}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                t.shadow,
                pressed && styles.buttonPressed,
                isCheckingStatus && styles.buttonDisabled,
              ]}
              onPress={() => void checkTopupStatus()}
              disabled={isCheckingStatus}
              accessibilityRole="button"
            >
              {isCheckingStatus ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.modalButtonText}>I&apos;ve Paid — Check Status</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryModalButton,
                { backgroundColor: t.card, borderColor: t.border },
                t.shadow,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.replace("/(app)/home")}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryModalButtonText, { color: t.text }]}>Back to Dashboard</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={paymentStatus === "failed"} transparent animationType="fade" statusBarTranslucent>
        <View style={[styles.modalOverlay, { backgroundColor: t.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
            <View style={[styles.successIconWrap, styles.failedIconWrap]}>
              <Text style={styles.modalIconText}>✕</Text>
            </View>
            <Text style={[styles.modalLabel, styles.failedLabel]}>PAYMENT FAILED</Text>
            <Text style={[styles.modalBody, { color: t.textSec }]}>{statusMessage}</Text>
            <View style={[styles.refBadge, { backgroundColor: t.cardAlt }]}>
              <Text style={[styles.refText, { color: t.textMut }]}>Ref: {reference}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                { backgroundColor: t.card, borderColor: t.border },
                t.shadow,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.back()}
              accessibilityRole="button"
            >
              <Text style={[styles.modalButtonText, { color: t.text }]}>Go Back</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  headerTitle: { flex: 1, fontFamily: fonts.bold, fontSize: fontSizes.headerTitle },
  headerSpacer: { width: dimensions.headerBackButton.size },
  referenceBadge: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  referenceText: { fontFamily: fonts.medium, fontSize: fontSizes.xs },
  webviewContainer: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: borders.medium,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  webview: { flex: 1, backgroundColor: "#fff" },
  webviewErrorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  webviewErrorTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    textAlign: "center",
  },
  webviewErrorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    textAlign: "center",
  },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  loadingCard: { alignItems: "center", gap: spacing.lg },
  loadingText: { fontFamily: fonts.medium, fontSize: fontSizes.body },
  footer: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, alignItems: "center", gap: spacing.md },
  footerText: { fontFamily: fonts.regular, fontSize: fontSizes.sm },
  statusButton: {
    minHeight: 48,
    minWidth: 220,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  statusButtonText: { fontFamily: fonts.semibold, fontSize: fontSizes.body },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  errorIcon: { fontSize: 48, marginBottom: spacing.lg },
  errorTitle: { fontFamily: fonts.bold, fontSize: fontSizes.h3, marginBottom: spacing.sm },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  errorButton: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
  },
  errorButtonText: { fontFamily: fonts.semibold, fontSize: fontSizes.button },
  modalOverlay: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  modalCard: {
    width: "100%",
    borderRadius: radii.xl,
    borderWidth: borders.standard,
    padding: spacing["2xl"],
    alignItems: "center",
    gap: spacing.md,
  },
  pixelRow: { flexDirection: "row", gap: 4, marginBottom: spacing.xs },
  pixel: { width: 8, height: 8, backgroundColor: "transparent" },
  pixelFilled: { backgroundColor: colors.primary },
  successIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    borderWidth: borders.medium,
    borderColor: colors.primaryText,
    alignItems: "center",
    justifyContent: "center",
  },
  pendingIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.secondary,
    borderWidth: borders.medium,
    borderColor: colors.primaryText,
    alignItems: "center",
    justifyContent: "center",
  },
  failedIconWrap: { backgroundColor: colors.error, borderColor: colors.error },
  modalIconText: {
    fontSize: 32,
    color: colors.primaryText,
    includeFontPadding: false,
    lineHeight: 32,
    textAlign: "center",
  },
  modalLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.primary,
    letterSpacing: 1,
    textAlign: "center",
  },
  failedLabel: { color: colors.error },
  modalBody: { fontFamily: fonts.regular, fontSize: fontSizes.body, textAlign: "center" },
  refBadge: { borderRadius: radii.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  refText: { fontFamily: fonts.medium, fontSize: fontSizes.xs },
  modalButton: {
    width: "100%",
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.primaryText,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  modalButtonText: { fontFamily: fonts.bold, fontSize: fontSizes.button, color: colors.primaryText },
  secondaryModalButton: {
    width: "100%",
    height: 52,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryModalButtonText: { fontFamily: fonts.semibold, fontSize: fontSizes.button },
  buttonPressed: { transform: [{ translateX: 3 }, { translateY: 3 }], shadowOffset: { width: 0, height: 0 } },
  buttonDisabled: { opacity: 0.6 },
});
