import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "../../src/auth/auth-state";
import { fetchMe } from "../../src/api/auth";
import { fetchLedger as fetchServerLedger } from "../../src/api/ledger";
import { listPendingByStatus, setLocalState } from "../../src/ledger/db";
import { syncPendingEnvelopes } from "../../src/api/reconcile";
import {
  MERCHANT_SCAN_CTA,
  MERCHANT_SCAN_INSTRUCTION,
  MERCHANT_SCAN_ROUTE,
} from "../../src/payment/merchant-flow";
import {
  getStoredStudentBalanceProjection,
  getStudentBalanceProjection,
  type StudentBalanceProjection,
} from "../../src/payment/balance-snapshot";
import {
  buildMerchantBalanceProjection,
  getPendingIncomingSummary,
  type MerchantBalanceProjection,
} from "../../src/payment/merchant-balance-projection";
import { formatClaimDeadline } from "../../src/payment/claim-window";
import { logger } from "../../src/lib/logger";
import { useThemeMode } from "../../src/theme/theme-provider";
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
} from "../../src/theme/tokens";

function formatNaira(kobo: number): string {
  return (
    "₦" +
    (kobo / 100).toLocaleString("en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

type TxnType = "sent" | "received" | "topup" | "cashout";

interface TxnItemProps {
  type: TxnType;
  label: string;
  amountKobo: number;
  time: string;
  status: "pending" | "confirmed";
}

interface TxnItemInternalProps extends TxnItemProps {
  t: ReturnType<typeof getTheme>;
}

function TxnItem({
  type,
  label,
  amountKobo,
  time,
  status,
  t,
}: TxnItemInternalProps): React.ReactElement {
  const icons: Record<TxnType, string> = {
    sent: "↑",
    received: "↓",
    topup: "↓",
    cashout: "↑",
  };
  const iconColors: Record<TxnType, string> = {
    sent: colors.error,
    received: colors.primary,
    topup: colors.primary,
    cashout: colors.secondary,
  };
  const isDebit = type === "sent" || type === "cashout";

  return (
    <View style={styles.txnItem}>
      <View
        style={[styles.txnIcon, { backgroundColor: iconColors[type] + "18", borderColor: t.border }]}
      >
        <Text style={[styles.txnIconText, { color: iconColors[type] }]}>
          {icons[type]}
        </Text>
      </View>
      <View style={styles.txnBody}>
        <Text style={[styles.txnLabel, { color: t.text }]}>{label}</Text>
        <Text style={[styles.txnTime, { color: t.textSec }]}>{time}</Text>
      </View>
      <View style={styles.txnRight}>
        <Text
          style={[
            styles.txnAmount,
            { color: isDebit ? colors.error : colors.primary },
          ]}
        >
          {isDebit ? "−" : "+"}
          {formatNaira(amountKobo)}
        </Text>
        <Text style={[styles.txnStatus, { color: t.textMut }]}>
          {status === "pending" ? "⏳ pending" : "✓"}
        </Text>
      </View>
    </View>
  );
}

interface RawLedgerEntry {
  id: string;
  type: "DEBIT" | "CREDIT";
  amountKobo: string;
  description: string;
  createdAt: string;
}

function mapLedgerEntry(entry: RawLedgerEntry): TxnItemProps {
  const isDebit = entry.type === "DEBIT";
  const desc = entry.description ?? "";

  let type: TxnType = isDebit ? "sent" : "topup";
  let label = desc;
  if (
    desc.startsWith("Top-up") ||
    desc.startsWith("TOPUP") ||
    desc.includes("Korapay")
  ) {
    type = "topup";
    label = "Top-up via Korapay";
  } else if (desc.startsWith("Cashout") || desc.includes("cashout")) {
    type = "cashout";
    label = "Cashout";
  } else if (isDebit) {
    type = "sent";
  } else {
    type = "received";
  }

  return {
    type,
    label,
    amountKobo: Number(entry.amountKobo),
    time: timeAgo(entry.createdAt),
    status: "confirmed",
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

/** Mask an email for display: "pelumi@stu.cu.edu.ng" → "pel***@stu.cu.edu.ng" */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = Math.min(3, local.length);
  return local.slice(0, visible) + "***@" + domain;
}

export default function HomeScreen(): React.ReactElement {
  const { state, hydrateProfile, reauthenticate } = useAuth();
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [balanceKobo, setBalanceKobo] = useState(
    state.status === "authed" ? Number(state.user.verifiedBalanceKobo) : 0,
  );
  const [merchantBalanceProjection, setMerchantBalanceProjection] =
    useState<MerchantBalanceProjection | null>(
      state.status === "authed" && state.user.role === "MERCHANT"
        ? buildMerchantBalanceProjection({
            settledBalanceKobo: Number(state.user.verifiedBalanceKobo),
            ...getPendingIncomingSummary(),
          })
        : null,
    );
  const [studentBalanceProjection, setStudentBalanceProjection] =
    useState<StudentBalanceProjection | null>(
      state.status === "authed" && state.user.role === "STUDENT"
        ? getStoredStudentBalanceProjection()
        : null,
    );
  const [ledgerEntries, setLedgerEntries] = useState<TxnItemProps[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [reauthSending, setReauthSending] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);

  const user = state.status === "authed" ? state.user : null;
  const jwtFresh = state.status === "authed" ? state.jwtFresh : false;

  function updateMerchantProjection(settledBalanceKobo: number): MerchantBalanceProjection {
    const projection = buildMerchantBalanceProjection({
      settledBalanceKobo,
      ...getPendingIncomingSummary(),
    });
    setMerchantBalanceProjection(projection);
    return projection;
  }

  useEffect(() => {
    if (!user || user.role !== "STUDENT" || !studentBalanceProjection) {
      return;
    }

    logger.debug("dashboard_balance_rendered", {
      userId: user.id,
      serverConfirmedBalanceKobo:
        studentBalanceProjection.serverConfirmedBalanceKobo,
      pendingOutgoingKobo: studentBalanceProjection.pendingOutgoingKobo,
      availableBalanceKobo: studentBalanceProjection.availableBalanceKobo,
      pendingOutgoingCount: studentBalanceProjection.pendingOutgoingCount,
      timestamp: new Date().toISOString(),
    });
  }, [studentBalanceProjection, user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      if (user.role === "STUDENT") {
        setStudentBalanceProjection(getStoredStudentBalanceProjection());
      }
      void refreshData();
      if (user.role === "MERCHANT") {
        const pending = listPendingByStatus(
          "pending_reconciliation",
          "incoming",
        );

        if (pending.length > 0 && jwtFresh && !isSyncing) {
          void (async () => {
            setIsSyncing(true);
            let refreshedBalance = false;
            try {
              logger.info("merchant_reconcile_refresh_started");
              await syncPendingEnvelopes();
              await refreshData();
              refreshedBalance = true;
              logger.info("merchant_reconcile_refresh_completed");
            } catch (err) {
              logger.info("Merchant auto-sync on focus failed", err);
            } finally {
              if (!refreshedBalance) {
                updateMerchantProjection(balanceKobo);
              }
              setIsSyncing(false);
            }
          })();
        }
      }

      const interval = setInterval(() => void refreshData(), 30_000);
      return () => clearInterval(interval);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.role, jwtFresh, isSyncing, hydrateProfile]),
  );

  async function refreshData(): Promise<void> {
    if (user?.role === "STUDENT") {
      try {
        const projection = await getStudentBalanceProjection(hydrateProfile);
        setStudentBalanceProjection(projection);
      } catch (err) {
        logger.info("Student balance projection refresh failed", err);
      }
    } else {
      try {
        const fresh = await fetchMe();
        hydrateProfile(fresh);
        const settledBalanceKobo = Number(fresh.verifiedBalanceKobo);
        setBalanceKobo(settledBalanceKobo);
        updateMerchantProjection(settledBalanceKobo);
        setLocalState("verified_balance_kobo", fresh.verifiedBalanceKobo);
        setLocalState("last_sync_at", new Date().toISOString());
      } catch (err) {
        logger.info("Balance refresh failed (offline?)", err);
        updateMerchantProjection(balanceKobo);
      }
    }
    try {
      const res = await fetchServerLedger(undefined, 10);
      setLedgerEntries(res.entries.map(mapLedgerEntry));
    } catch (err) {
      logger.info("Ledger fetch failed", err);
    }
  }

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  }

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true);
    let refreshedBalance = false;
    try {
      logger.info("merchant_reconcile_refresh_started");
      await syncPendingEnvelopes();
      await refreshData();
      refreshedBalance = true;
      logger.info("merchant_reconcile_refresh_completed");
    } finally {
      if (!refreshedBalance) {
        updateMerchantProjection(balanceKobo);
      }
      setIsSyncing(false);
    }
  };

  // Re-auth: send OTP to the stored email and navigate to verify screen.
  // No email input shown — the stored email is used automatically.
  const handleReauth = async (): Promise<void> => {
    setReauthSending(true);
    setReauthError(null);
    try {
      const storedEmail = await reauthenticate();
      router.push({ pathname: "/(auth)/verify", params: { email: storedEmail } });
    } catch (err) {
      logger.info("Re-auth OTP request failed", err);
      setReauthError("Could not send OTP. Check your connection.");
    } finally {
      setReauthSending(false);
    }
  };

  if (state.status !== "authed" || !user) {
    return <View />;
  }

  const email = user.email ?? "";
  const firstName = email.split("@")[0]?.split(".")[0] ?? "there";
  const capName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const isNewUser = ledgerEntries.length === 0;
  const availableBalanceKobo =
    studentBalanceProjection?.availableBalanceKobo ??
    Number(user.verifiedBalanceKobo);
  const pendingOutgoingKobo = studentBalanceProjection?.pendingOutgoingKobo ?? 0;
  const pendingOutgoingCount =
    studentBalanceProjection?.pendingOutgoingCount ?? 0;
  const studentBalanceStatusText =
    studentBalanceProjection?.source === "server"
      ? "Updated just now"
      : studentBalanceProjection?.lastSyncedAt
        ? "Using last synced balance"
        : "Last known available balance";
  const studentPendingOutgoingRows =
    user.role === "STUDENT"
      ? listPendingByStatus("pending_reconciliation", "outgoing")
      : [];
  const primaryPendingOutgoing =
    studentPendingOutgoingRows.length === 1 ? studentPendingOutgoingRows[0] : null;
  let primaryPendingClaimDeadline: string | null = null;
  if (primaryPendingOutgoing) {
    try {
      const parsed = JSON.parse(primaryPendingOutgoing.envelopeJson) as { timestamp?: string };
      if (typeof parsed.timestamp === "string") {
        primaryPendingClaimDeadline = formatClaimDeadline(parsed.timestamp);
      }
    } catch {
      primaryPendingClaimDeadline = null;
    }
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );

  const activitySection = (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: t.text }]}>Recent Activity</Text>
        <Pressable onPress={() => router.push("/(app)/history")}>
          <Text style={styles.seeAllLink}>See All →</Text>
        </Pressable>
      </View>
      <View style={[styles.activityCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
        {ledgerEntries.length > 0 ? (
          ledgerEntries.map((tx, i) => <TxnItem key={i} {...tx} t={t} />)
        ) : (
          <View style={styles.emptyActivity}>
            <Text style={[styles.emptyIcon, { color: t.textMut }]}>₦</Text>
            <Text style={[styles.emptyTitle, { color: t.text }]}>No transactions yet</Text>
            <Text style={[styles.emptyBody, { color: t.textSec }]}>
              Top up and make your first payment to see activity here.
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  if (user.role === "STUDENT") {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.welcomeText, { color: t.textSec }]}>
                {isNewUser ? "Welcome," : "Welcome back,"}
              </Text>
              <Text style={[styles.nameText, { color: t.text }]}>{capName} 👋</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.settingsButton,
                { borderColor: t.border, backgroundColor: t.card },
                t.shadow,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/(app)/settings")}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Text style={[styles.settingsIcon, { color: t.text }]}>⚙</Text>
            </Pressable>
          </View>

          {!jwtFresh && (
            <View style={styles.staleBanner}>
              <Text style={styles.staleBannerText}>
                Your session has expired.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.reauthButton,
                  pressed && styles.reauthButtonPressed,
                ]}
                onPress={() => void handleReauth()}
                disabled={reauthSending || !email}
              >
                {reauthSending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.reauthButtonText}>
                    Send OTP to {maskEmail(email)}
                  </Text>
                )}
              </Pressable>
              {reauthError ? (
                <Text style={styles.reauthError}>{reauthError}</Text>
              ) : null}
            </View>
          )}

          {/* Balance Card */}
          <View style={[styles.balanceCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
            <View style={styles.pixelCorner}>
              {[0, 1, 2, 3, 4].map((r) => (
                <View key={r} style={styles.pixelRow}>
                  {[0, 1, 2, 3, 4].map((c) => (
                    <View
                      key={c}
                      style={[
                        styles.pixelDot,
                        (r + c) % 2 === 0 && styles.pixelDotFilled,
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
            <View style={styles.balanceHeader}>
              <View>
                <Text style={[styles.balanceLabel, { color: t.textSec }]}>Available Balance</Text>
                <Text style={[styles.balanceAmount, { color: t.text }]}>
                  {formatNaira(availableBalanceKobo)}
                </Text>
                <Text style={[styles.balanceUpdated, { color: t.textMut }]}>
                  {studentBalanceStatusText}
                </Text>
                {pendingOutgoingKobo > 0 ? (
                  <Text style={[styles.balancePendingSummary, { color: t.textSec }]}>
                    {formatNaira(pendingOutgoingKobo)} pending offline payment
                    {pendingOutgoingCount === 1 ? "" : "s"}
                  </Text>
                ) : null}
                {primaryPendingOutgoing ? (
                  <Text style={[styles.balancePendingDetail, { color: t.textMut }]}>
                    Reserved for {primaryPendingOutgoing.recipientLabel || "offline payment"}
                  </Text>
                ) : null}
                {primaryPendingClaimDeadline ? (
                  <Text style={[styles.balancePendingDetail, { color: t.textMut }]}>
                    Claim deadline: {primaryPendingClaimDeadline}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.connectDot,
                  !jwtFresh && styles.connectDotStale,
                ]}
              />
            </View>
            <View style={styles.badgeRow}>
              <View style={styles.paymentsBadge}>
                <Text style={styles.badgeText}>
                  {ledgerEntries.length} PAYMENTS
                </Text>
              </View>
            </View>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionButtonPrimary,
                { borderColor: t.border },
                t.shadow,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/(app)/pay/scan")}
              accessibilityRole="button"
            >
              <Text style={styles.actionTextPrimary}>Pay</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionButtonSecondary,
                { backgroundColor: t.card, borderColor: t.border },
                t.shadow,
                pressed && styles.buttonPressed,
                !jwtFresh && styles.buttonDisabled,
              ]}
              onPress={() => router.push("/(app)/topup/amount")}
              accessibilityRole="button"
              disabled={!jwtFresh}
            >
              <Text style={styles.actionIcon}>↓</Text>
              <Text style={[styles.actionTextSecondary, { color: t.text }]}>Top Up</Text>
            </Pressable>
          </View>

          {activitySection}

          {ledgerEntries.length >= 10 && ledgerEntries.length < 25 && (
            <View style={[styles.milestoneCard, t.shadow]}>
              <Text style={styles.milestoneIcon}>🎯</Text>
              <View style={styles.milestoneBody}>
                <Text style={styles.milestoneLabel}>MILESTONE</Text>
                <Text style={[styles.milestoneText, { color: t.text }]}>
                  {ledgerEntries.length} payments! You're a regular.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  const merchantProjectionForRender =
    merchantBalanceProjection ??
    buildMerchantBalanceProjection({
      settledBalanceKobo: balanceKobo,
      ...getPendingIncomingSummary(),
    });

  // MERCHANT VIEW
  // ══════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.welcomeText, { color: t.textSec }]}>
              {isNewUser ? "Welcome," : "Welcome back,"}
            </Text>
            <Text style={[styles.nameText, { color: t.text }]}>{capName} 🏪</Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.settingsButton,
              { borderColor: t.border, backgroundColor: t.card },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push("/(app)/settings")}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={[styles.settingsIcon, { color: t.text }]}>⚙</Text>
          </Pressable>
        </View>

        {!jwtFresh && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              Your session has expired.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.reauthButton,
                pressed && styles.reauthButtonPressed,
              ]}
              onPress={() => void handleReauth()}
              disabled={reauthSending || !email}
            >
              {reauthSending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.reauthButtonText}>
                  Send OTP to {maskEmail(email)}
                </Text>
              )}
            </Pressable>
            {reauthError ? (
              <Text style={styles.reauthError}>{reauthError}</Text>
            ) : null}
          </View>
        )}

        <View style={[styles.balanceCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <View style={styles.pixelCorner}>
            {[0, 1, 2, 3, 4].map((r) => (
              <View key={r} style={styles.pixelRow}>
                {[0, 1, 2, 3, 4].map((c) => (
                  <View
                    key={c}
                    style={[
                      styles.pixelDot,
                      (r + c) % 2 === 0 && styles.pixelDotFilled,
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
          <View style={styles.balanceHeader}>
            <View>
              <Text style={[styles.balanceLabel, { color: t.textSec }]}>Settled Balance</Text>
              <Text style={[styles.balanceAmount, { color: t.text }]}>
                {formatNaira(merchantProjectionForRender.settledBalanceKobo)}
              </Text>
              <Text style={[styles.balanceUpdated, { color: t.textMut }]}>
                {jwtFresh ? "✓ Updated just now" : "Last known settled balance"}
              </Text>
              {merchantProjectionForRender.hasPendingSync ? (
                <>
                  <Text style={[styles.balancePendingSummary, { color: t.textSec }]}>
                    Pending Verification: {formatNaira(merchantProjectionForRender.pendingIncomingKobo)}
                  </Text>
                  <Text style={[styles.balancePendingDetail, { color: t.textMut }]}>
                    from {merchantProjectionForRender.pendingIncomingCount} payment
                    {merchantProjectionForRender.pendingIncomingCount === 1 ? "" : "s"}.
                    {" "}Sync to make these payments available for cashout.
                  </Text>
                </>
              ) : null}
              <Text style={[styles.balancePendingSummary, { color: t.textSec }]}>
                Available for Cashout: {formatNaira(merchantProjectionForRender.cashoutableBalanceKobo)}
              </Text>
            </View>
            <View
              style={[
                styles.connectDot,
                !jwtFresh && styles.connectDotStale,
              ]}
            />
          </View>
          <View style={styles.badgeRow}>
            <View style={styles.merchantBadge}>
              <Text style={styles.badgeText}>MERCHANT</Text>
            </View>
          </View>
        </View>

        <View style={[styles.syncCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <View>
            <Text style={[styles.syncTitle, { color: t.textSec }]}>Pending Verification</Text>
            <Text style={[styles.syncCount, { color: t.text }]}>
              {merchantProjectionForRender.pendingIncomingCount} payments
            </Text>
            {merchantProjectionForRender.hasPendingSync ? (
              <Text style={[styles.syncAmount, { color: t.textSec }]}>
                {formatNaira(merchantProjectionForRender.pendingIncomingKobo)} pending sync
              </Text>
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.syncButton,
              { backgroundColor: t.text },
              pressed && styles.buttonPressed,
              (isSyncing || merchantProjectionForRender.pendingIncomingCount === 0 || !jwtFresh) &&
              styles.buttonDisabled,
            ]}
            onPress={() => void handleSync()}
            disabled={isSyncing || merchantProjectionForRender.pendingIncomingCount === 0 || !jwtFresh}
          >
            <Text style={[styles.syncButtonText, { color: t.bg }]}>
              {isSyncing ? "Syncing..." : "Sync Now"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.quickActions}>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonPrimary,
              { borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push(MERCHANT_SCAN_ROUTE)}
            accessibilityRole="button"
          >
            <Text style={styles.actionTextPrimary}>{MERCHANT_SCAN_CTA}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonSecondary,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
              !jwtFresh && styles.buttonDisabled,
            ]}
            onPress={() => router.push("/(app)/merchant/cashout")}
            accessibilityRole="button"
            disabled={!jwtFresh}
          >
            <Text style={styles.actionIcon}>↑</Text>
            <Text style={[styles.actionTextSecondary, { color: t.text }]}>Cash Out</Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.merchantFlowCard,
            { backgroundColor: t.card, borderColor: t.border },
            t.shadow,
          ]}
        >
          <Text style={[styles.merchantFlowTitle, { color: t.text }]}>
            Student-led payments
          </Text>
          <Text style={[styles.merchantFlowBody, { color: t.textSec }]}>
            {MERCHANT_SCAN_INSTRUCTION}
          </Text>
        </View>

        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [
              styles.listItem,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.listItemPressed,
            ]}
            onPress={() => router.push("/(app)/merchant/cashout-history")}
            disabled={!jwtFresh}
          >
            <Text style={[styles.listItemText, { color: t.text }]}>Cashout History</Text>
            <Text style={[styles.listItemArrow, { color: t.textMut }]}>→</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.listItem,
              { backgroundColor: t.card, borderColor: t.border },
              t.shadow,
              pressed && styles.listItemPressed,
            ]}
            onPress={() => router.push("/(app)/history")}
          >
            <Text style={[styles.listItemText, { color: t.text }]}>Transaction History</Text>
            <Text style={[styles.listItemArrow, { color: t.textMut }]}>→</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing["3xl"] },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  welcomeText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
  },
  nameText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    marginTop: 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: { fontSize: 18 },

  staleBanner: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "60",
    borderRadius: radii.md,
    padding: spacing.md,
  },
  staleBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: "#7a4d00",
  },
  reauthButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary + "18",
    borderWidth: borders.thin,
    borderColor: colors.primary + "40",
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  reauthButtonPressed: {
    opacity: 0.7,
  },
  reauthButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.caption,
    color: colors.primary,
  },
  reauthError: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.error,
    marginTop: spacing.xs,
  },

  balanceCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    position: "relative",
    overflow: "hidden",
  },
  pixelCorner: { position: "absolute", top: 0, right: 0, opacity: 0.08 },
  pixelRow: { flexDirection: "row" },
  pixelDot: { width: 8, height: 8, backgroundColor: "transparent" },
  pixelDotFilled: { backgroundColor: colors.primary },
  balanceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  balanceLabel: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
  },
  balanceAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.balance,
    marginTop: spacing.xs,
    letterSpacing: -1,
  },
  balanceUpdated: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  balancePendingSummary: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    marginTop: spacing.sm,
  },
  balancePendingDetail: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  connectDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  connectDotStale: {
    backgroundColor: colors.secondary,
    shadowColor: colors.secondary,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  paymentsBadge: {
    backgroundColor: colors.primary + "15",
    borderWidth: borders.thin,
    borderColor: colors.primary + "30",
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  merchantBadge: {
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "40",
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  badgeText: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.primary,
  },

  quickActions: {
    flexDirection: "row",
    gap: spacing.lg,
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
  },
  merchantFlowCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
    gap: spacing.xs,
  },
  merchantFlowTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  merchantFlowBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 52,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
  },
  actionButtonPrimary: {
    backgroundColor: colors.primary,
  },
  actionButtonSecondary: {},
  actionIcon: { fontSize: 20 },
  actionTextPrimary: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  actionTextSecondary: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
  },

  section: { marginHorizontal: spacing.xl, marginTop: spacing.sectionGap },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sectionTitle,
  },
  seeAllLink: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.caption,
    color: colors.primary,
  },

  activityCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },

  emptyActivity: {
    alignItems: "center",
    paddingVertical: spacing["3xl"],
    gap: spacing.sm,
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    textAlign: "center",
    lineHeight: 20,
  },

  txnItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  txnIcon: {
    width: dimensions.txnIcon.size,
    height: dimensions.txnIcon.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  txnIconText: { fontSize: 18, fontWeight: "800" },
  txnBody: { flex: 1 },
  txnLabel: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
  },
  txnTime: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: 2,
  },
  txnRight: { alignItems: "flex-end" },
  txnAmount: { fontFamily: fonts.bold, fontSize: fontSizes.body },
  txnStatus: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    marginTop: 1,
  },

  milestoneCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    backgroundColor: "#FFFDF0",
    borderWidth: borders.standard,
    borderColor: colors.secondary + "50",
    borderRadius: radii.xl,
    padding: spacing.cardPad,
  },
  milestoneIcon: { fontSize: 28 },
  milestoneBody: { flex: 1 },
  milestoneLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.secondary,
  },
  milestoneText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    marginTop: spacing.xs,
  },

  syncCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
  },
  syncTitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  syncCount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    marginTop: spacing.xs,
  },
  syncAmount: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  syncButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  syncButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
  },

  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
    marginBottom: spacing.md,
  },
  listItemPressed: {
    transform: [{ translateX: 2 }, { translateY: 2 }],
    shadowOffset: { width: 0, height: 0 },
  },
  listItemText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.bodyLg,
  },
  listItemArrow: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },

  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  buttonDisabled: { opacity: 0.5 },
});
