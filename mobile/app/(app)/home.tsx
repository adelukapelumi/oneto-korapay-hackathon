import { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { MAX_USER_BALANCE_KOBO } from "@oneto/shared";
import { useAuth } from "../../src/auth/auth-state";
import { fetchMe } from "../../src/api/auth";
import { apiClient } from "../../src/api/client";
import { listPendingByStatus, setLocalState } from "../../src/ledger/db";
import { syncPendingEnvelopes } from "../../src/api/reconcile";
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

async function fetchLedger(limit: number): Promise<RawLedgerEntry[]> {
  const response = await apiClient.get<{ entries: RawLedgerEntry[] }>(
    `/me/ledger?limit=${limit}`,
  );
  return response.data.entries ?? [];
}

export default function HomeScreen(): React.ReactElement {
  const { state } = useAuth();
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [balanceKobo, setBalanceKobo] = useState(
    state.status === "authed" ? Number(state.user.verifiedBalanceKobo) : 0,
  );
  const [ledgerEntries, setLedgerEntries] = useState<TxnItemProps[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const user = state.status === "authed" ? state.user : null;
  const jwtFresh = state.status === "authed" ? state.jwtFresh : false;

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void refreshData();
      if (user.role === "MERCHANT") {
        const pending = listPendingByStatus(
          "pending_reconciliation",
          "incoming",
        );
        setPendingCount(pending.length);
      }

      const interval = setInterval(() => void refreshData(), 30_000);
      return () => clearInterval(interval);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.role]),
  );

  async function refreshData(): Promise<void> {
    try {
      const fresh = await fetchMe();
      setBalanceKobo(Number(fresh.verifiedBalanceKobo));
      setLocalState("verified_balance_kobo", fresh.verifiedBalanceKobo);
      setLocalState("last_sync_at", new Date().toISOString());
    } catch (err) {
      logger.info("Balance refresh failed (offline?)", err);
    }
    try {
      const res = await fetchLedger(10);
      setLedgerEntries(res.map(mapLedgerEntry));
    } catch (err) {
      logger.info("Ledger fetch failed", err);
    }
  }

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    await refreshData();
    if (user?.role === "MERCHANT") {
      const pending = listPendingByStatus(
        "pending_reconciliation",
        "incoming",
      );
      setPendingCount(pending.length);
    }
    setRefreshing(false);
  }

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true);
    await syncPendingEnvelopes();
    const pending = listPendingByStatus("pending_reconciliation", "incoming");
    setPendingCount(pending.length);
    setIsSyncing(false);
  };

  if (state.status !== "authed" || !user) {
    return <View />;
  }

  const email = user.email ?? "";
  const firstName = email.split("@")[0]?.split(".")[0] ?? "there";
  const capName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const isNewUser = ledgerEntries.length === 0;

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
                Sign in again to top up or see your latest balance.
              </Text>
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
                <Text style={[styles.balanceLabel, { color: t.textSec }]}>Total Balance</Text>
                <Text style={[styles.balanceAmount, { color: t.text }]}>
                  {formatNaira(balanceKobo)}
                </Text>
                <Text style={[styles.balanceUpdated, { color: t.textMut }]}>
                  {jwtFresh ? "✓ Updated just now" : "Last known balance"}
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
              Sign in again to cash out or see your latest balance.
            </Text>
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
              <Text style={[styles.balanceLabel, { color: t.textSec }]}>Total Balance</Text>
              <Text style={[styles.balanceAmount, { color: t.text }]}>
                {formatNaira(balanceKobo)}
              </Text>
              <Text style={[styles.balanceUpdated, { color: t.textMut }]}>
                {jwtFresh ? "✓ Updated just now" : "Last known balance"}
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
            <Text style={[styles.syncTitle, { color: t.textSec }]}>Pending Syncs</Text>
            <Text style={[styles.syncCount, { color: t.text }]}>{pendingCount} payments</Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.syncButton,
              { backgroundColor: t.text },
              pressed && styles.buttonPressed,
              (isSyncing || pendingCount === 0 || !jwtFresh) &&
              styles.buttonDisabled,
            ]}
            onPress={() => void handleSync()}
            disabled={isSyncing || pendingCount === 0 || !jwtFresh}
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
            onPress={() => router.push("/(app)/merchant/charge")}
            accessibilityRole="button"
          >
            <Text style={styles.actionIcon}>💳</Text>
            <Text style={styles.actionTextPrimary}>Charge</Text>
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
