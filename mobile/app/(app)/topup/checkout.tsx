import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { fetchMe } from "../../../src/api/auth";
import { setLocalState } from "../../../src/ledger/db";
import { logger } from "../../../src/lib/logger";
import {
  colors,
  fonts,
  fontSizes,
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

  const [isLoading, setIsLoading] = useState(true);
  const hasRefreshed = useRef(false);

  useEffect(() => {
    return () => {
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
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
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
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Complete Top Up</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Reference badge */}
      {reference && (
        <View style={styles.referenceBadge}>
          <Text style={styles.referenceText}>Ref: {reference}</Text>
        </View>
      )}

      {/* WebView Container */}
      <View style={styles.webviewContainer}>
        <WebView
          source={{ uri: paymentUrl }}
          style={styles.webview}
          startInLoadingState={false}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
        />

        {/* Loading Overlay */}
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading payment...</Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer hint */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Complete your payment securely via Korapay
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.light.bg,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
    backgroundColor: colors.light.bg,
  },
  backButton: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.card,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    fontSize: 18,
    color: colors.light.text,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
    color: colors.light.text,
  },
  headerSpacer: {
    width: dimensions.headerBackButton.size,
  },

  // Reference Badge
  referenceBadge: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.light.cardAlt,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  referenceText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.xs,
    color: colors.light.textMut,
  },

  // WebView
  webviewContainer: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  webview: {
    flex: 1,
    backgroundColor: "#fff",
  },

  // Loading
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.light.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingCard: {
    alignItems: "center",
    gap: spacing.lg,
  },
  loadingText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
  },

  // Footer
  footer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.light.textMut,
  },

  // Error Screen
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    color: colors.light.text,
    marginBottom: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  errorButton: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    backgroundColor: colors.light.card,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
  },
  errorButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.button,
    color: colors.light.text,
  },

  // Shared
  buttonPressed: {
    transform: [{ translateX: 2 }, { translateY: 2 }],
  },
});
