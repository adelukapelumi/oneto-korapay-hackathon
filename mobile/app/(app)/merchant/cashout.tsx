import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import { fetchMe } from "../../../src/api/auth";
import { getCashoutStatus, requestCashout, Cashout } from "../../../src/api/cashout";
import { ApiError, NetworkError } from "../../../src/api/errors";
import { setLocalState } from "../../../src/ledger/db";
import {
  buildMerchantBalanceProjection,
  getActiveCashoutSummary,
  getCashoutBalanceDisplay,
  getCashoutRequestDecision,
  getPendingIncomingSummary,
  shouldStartCashoutBalanceRefresh,
  type ActiveCashoutSummary,
  type CashoutBalanceFetchState,
  type CashoutRequestBlockReason,
  type MerchantBalanceProjection,
} from "../../../src/payment/merchant-balance-projection";
import { logger } from "../../../src/lib/logger";
import {
  KORAPAY_PAYOUT_FEE_PENDING_TEXT,
  FINAL_PAYOUT_PENDING_TEXT,
  formatCashoutKobo as formatKobo,
  getFinalMerchantPayoutText,
  getKorapayPayoutFeeText,
} from "../../../src/payment/cashout-fee-display";
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

function getCashoutBlockMessage(reason: CashoutRequestBlockReason): string {
  switch (reason) {
    case "jwt_stale":
      return "Sign in again to request a cashout.";
    case "balance_unconfirmed":
      return "Connect to the internet to confirm your cashout balance.";
    case "zero_balance":
      return "Your available cashout balance is zero.";
    case "request_in_progress":
      return "Please wait while your cashout balance is being confirmed.";
    case "active_cashout":
      return "You already have a cashout pending.";
  }
}

function calculateOnetoFeePreviewKobo(grossAmountKobo: number): number {
  return Math.floor((grossAmountKobo * 250) / 10_000);
}

export default function CashoutScreen(): React.ReactElement {
  const router = useRouter();
  const { state, hydrateProfile } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<Cashout | null>(null);
  const [projection, setProjection] =
    useState<MerchantBalanceProjection | null>(null);
  const [balanceFetchState, setBalanceFetchState] =
    useState<CashoutBalanceFetchState>("offline_unconfirmed");
  const [activeCashout, setActiveCashout] =
    useState<ActiveCashoutSummary | null>(null);
  const refreshInFlightRef = useRef(false);
  const isAuthed = state.status === "authed";

  const refreshCashoutBalance = useCallback(async () => {
    if (
      !shouldStartCashoutBalanceRefresh({
        isAuthed,
        isRefreshInFlight: refreshInFlightRef.current,
      })
    ) {
      return;
    }

    refreshInFlightRef.current = true;
    setBalanceFetchState("loading");
    setError(null);

    try {
      const [fresh, cashouts] = await Promise.all([
        fetchMe(),
        getCashoutStatus(),
      ]);
      hydrateProfile(fresh);
      const settledBalanceKobo = Number(fresh.verifiedBalanceKobo);
      const nextProjection = buildMerchantBalanceProjection({
        settledBalanceKobo,
        ...getPendingIncomingSummary(),
      });
      const nextActiveCashout = getActiveCashoutSummary(cashouts);

      setProjection(nextProjection);
      setActiveCashout(nextActiveCashout);
      setBalanceFetchState("confirmed");
      setLocalState("verified_balance_kobo", fresh.verifiedBalanceKobo);
      setLocalState("last_sync_at", new Date().toISOString());
      logger.debug("cashout_balance_rendered", {
        hasPendingSync: nextProjection.hasPendingSync,
        pendingIncomingCount: nextProjection.pendingIncomingCount,
        balanceConfirmedOnline: true,
        hasActiveCashout: nextActiveCashout !== null,
      });
    } catch (err) {
      logger.info("Cashout balance refresh failed", err);
      setProjection(
        buildMerchantBalanceProjection({
          settledBalanceKobo: 0,
          ...getPendingIncomingSummary(),
        }),
      );
      setActiveCashout(null);
      if (err instanceof NetworkError) {
        setBalanceFetchState("offline_unconfirmed");
        setError("Connect to the internet to confirm your cashout balance.");
      } else {
        setBalanceFetchState("error");
        setError(
          "Could not confirm your cashout balance. Check your connection and try again.",
        );
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [hydrateProfile, isAuthed]);

  useFocusEffect(
    useCallback(() => {
      void refreshCashoutBalance();
    }, [refreshCashoutBalance]),
  );

  if (state.status !== "authed") {
    return <View />;
  }

  const { jwtFresh } = state;
  const balanceProjection =
    projection ??
    buildMerchantBalanceProjection({
      settledBalanceKobo: 0,
      ...getPendingIncomingSummary(),
    });
  const balanceDisplay = getCashoutBalanceDisplay({
    fetchState: balanceFetchState,
    cashoutableBalanceKobo: balanceProjection.cashoutableBalanceKobo,
    activeCashout,
  });
  const displayCashoutableBalanceKobo =
    balanceDisplay.kind === "amount"
      ? balanceDisplay.cashoutableBalanceKobo
      : balanceProjection.cashoutableBalanceKobo;
  const balanceNaira = (displayCashoutableBalanceKobo / 100).toFixed(2);
  const previewOnetoFeeKobo = calculateOnetoFeePreviewKobo(displayCashoutableBalanceKobo);
  const previewPayoutBeforeKorapayFeeKobo =
    displayCashoutableBalanceKobo - previewOnetoFeeKobo;
  const balanceConfirmedOnline = balanceFetchState === "confirmed";
  const cashoutDecision = getCashoutRequestDecision({
    jwtFresh,
    balanceConfirmedOnline,
    cashoutableBalanceKobo: displayCashoutableBalanceKobo,
    isRequestInProgress: loading || balanceFetchState === "loading",
    activeCashout,
  });

  const handleRequestCashout = async () => {
    if (!cashoutDecision.canRequestCashout) {
      setError(getCashoutBlockMessage(cashoutDecision.reason));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await requestCashout();
      setActiveCashout({
        amountKobo: Number(res.grossAmountKobo),
        grossAmountKobo: Number(res.grossAmountKobo),
        status: res.status,
      });
      setSuccessData(res);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to request cashout");
      } else if (err instanceof Error) {
        setError(err.message || "An unexpected error occurred");
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Request Cashout</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.container}>
        {!jwtFresh && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              Sign in again to request a cashout.
            </Text>
          </View>
        )}

        <View style={[styles.balanceCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <Text style={[styles.balanceLabel, { color: t.textSec }]}>Available for Cashout</Text>
          {balanceDisplay.kind === "loading" ? (
            <ActivityIndicator color={colors.primary} style={styles.balanceSpinner} />
          ) : (
            <Text style={[styles.balanceAmount, { color: t.text }]}>
              {balanceConfirmedOnline ? `${"\u20A6"}${balanceNaira}` : "Confirm online"}
            </Text>
          )}
          {balanceFetchState === "offline_unconfirmed" ? (
            <Text style={[styles.balanceNote, { color: t.textSec }]}>
              Connect to the internet to confirm your cashout balance.
            </Text>
          ) : null}
          {activeCashout ? (
            <Text style={[styles.balanceNote, { color: t.textSec }]}>
              Cashout pending: {"\u20A6"}{(activeCashout.amountKobo / 100).toFixed(2)} requested.
            </Text>
          ) : null}
          {balanceProjection.hasPendingSync ? (
            <Text style={[styles.balanceNote, { color: t.textSec }]}>
              ₦{(balanceProjection.pendingIncomingKobo / 100).toFixed(2)} pending verification is not yet cashoutable.
            </Text>
          ) : null}
          {balanceConfirmedOnline && !activeCashout ? (
            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Gross cashout</Text>
                <Text style={[styles.breakdownValue, { color: t.text }]}>
                  {formatKobo(displayCashoutableBalanceKobo)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Oneto service fee (2.5%)</Text>
                <Text style={[styles.breakdownValue, { color: t.text }]}>
                  {formatKobo(previewOnetoFeeKobo)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Korapay payout fee</Text>
                <Text style={[styles.breakdownValue, { color: t.textSec }]}>
                  {KORAPAY_PAYOUT_FEE_PENDING_TEXT}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Final merchant payout</Text>
                <Text style={[styles.breakdownValue, { color: t.textSec }]}>
                  {FINAL_PAYOUT_PENDING_TEXT}
                </Text>
              </View>
              <Text style={[styles.balanceNote, { color: t.textSec }]}>
                Amount sent to Korapay starts from {formatKobo(previewPayoutBeforeKorapayFeeKobo)} before Korapay confirms fee handling.
              </Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {successData ? (
          <View style={[styles.successCard, { backgroundColor: t.card, borderColor: colors.primary }, t.shadow]}>
            <View style={styles.pixelRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[styles.pixel, i % 2 === 0 && styles.pixelFilled]} />
              ))}
            </View>
            <Text style={styles.successLabel}>CASHOUT REQUESTED</Text>
            <Text style={[styles.successAmount, { color: t.text }]}>
              {formatKobo(successData.grossAmountKobo)}
            </Text>
            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Gross cashout</Text>
                <Text style={[styles.breakdownValue, { color: t.text }]}>
                  {formatKobo(successData.grossAmountKobo)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Oneto service fee (2.5%)</Text>
                <Text style={[styles.breakdownValue, { color: t.text }]}>
                  {formatKobo(successData.onetoFeeKobo)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Korapay payout fee</Text>
                <Text style={[styles.breakdownValue, { color: t.textSec }]}>
                  {getKorapayPayoutFeeText(successData)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Final merchant payout</Text>
                <Text style={[styles.breakdownValue, { color: t.textSec }]}>
                  {getFinalMerchantPayoutText(successData)}
                </Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={[styles.breakdownLabel, { color: t.textSec }]}>Amount sent to Korapay</Text>
                <Text style={[styles.breakdownValue, { color: t.textSec }]}>
                  {formatKobo(successData.korapayTransferAmountKobo)}
                </Text>
              </View>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>⏳ {successData.status}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.historyButton,
                { borderColor: t.border },
                t.shadow,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.replace("/(app)/merchant/cashout-history")}
            >
              <Text style={styles.historyButtonText}>View History →</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.spacer} />
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { borderColor: t.border },
                t.shadow,
                !cashoutDecision.canRequestCashout && styles.disabledButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleRequestCashout}
              disabled={!cashoutDecision.canRequestCashout}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.primaryButtonText}>Request Cashout</Text>
              )}
            </Pressable>
          </>
        )}
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
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingBottom: spacing["2xl"],
  },
  staleBanner: {
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "60",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  staleBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: "#7a4d00",
    textAlign: "center",
  },
  balanceCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  balanceLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  balanceAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    marginTop: spacing.xs,
    letterSpacing: -1,
  },
  balanceSpinner: {
    marginTop: spacing.md,
  },
  balanceNote: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    marginTop: spacing.sm,
    textAlign: "center",
    lineHeight: 18,
  },
  breakdown: {
    width: "100%",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  breakdownLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
  },
  breakdownValue: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
    textAlign: "right",
  },
  errorBox: {
    backgroundColor: colors.error + "15",
    borderWidth: borders.thin,
    borderColor: colors.error + "30",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },
  successCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing["2xl"],
    alignItems: "center",
    gap: spacing.sm,
  },
  pixelRow: { flexDirection: "row", gap: 4, marginBottom: spacing.xs },
  pixel: { width: 8, height: 8, backgroundColor: "transparent" },
  pixelFilled: { backgroundColor: colors.primary },
  successLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.primary,
    letterSpacing: 1,
  },
  successAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    letterSpacing: -1,
  },
  statusBadge: {
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "40",
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  statusBadgeText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.secondary,
  },
  historyButton: {
    marginTop: spacing.md,
    width: "100%",
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  historyButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  spacer: { flex: 1 },
  primaryButton: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  disabledButton: { opacity: 0.5 },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
});
