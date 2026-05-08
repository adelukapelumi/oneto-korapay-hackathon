import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { MAX_USER_BALANCE_KOBO } from "@oneto/shared";
import { useAuth } from "../../src/auth/auth-state";
import { listPendingByStatus } from "../../src/ledger/db";
import { syncPendingEnvelopes } from "../../src/api/reconcile";
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
} from "../../src/theme/tokens";

function formatNaira(kobo: number): string {
  return "₦" + (kobo / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type TxnType = "sent" | "received" | "topup" | "cashout";

interface TxnItemProps {
  type: TxnType;
  label: string;
  amountKobo: number;
  time: string;
  status: "pending" | "confirmed";
}

function TxnItem({ type, label, amountKobo, time, status }: TxnItemProps): React.ReactElement {
  const icons: Record<TxnType, string> = { sent: "↑", received: "↓", topup: "↓", cashout: "↑" };
  const iconColors: Record<TxnType, string> = {
    sent: colors.error,
    received: colors.primary,
    topup: colors.primary,
    cashout: colors.secondary,
  };
  const isDebit = type === "sent" || type === "cashout";

  return (
    <View style={styles.txnItem}>
      <View style={[styles.txnIcon, { backgroundColor: iconColors[type] + "18" }]}>
        <Text style={[styles.txnIconText, { color: iconColors[type] }]}>{icons[type]}</Text>
      </View>
      <View style={styles.txnBody}>
        <Text style={styles.txnLabel}>{label}</Text>
        <Text style={styles.txnTime}>{time}</Text>
      </View>
      <View style={styles.txnRight}>
        <Text style={[styles.txnAmount, { color: isDebit ? colors.error : colors.primary }]}>
          {isDebit ? "−" : "+"}{formatNaira(amountKobo)}
        </Text>
        <Text style={styles.txnStatus}>
          {status === "pending" ? "⏳ pending" : "✓"}
        </Text>
      </View>
    </View>
  );
}

const SAMPLE_TXN: TxnItemProps[] = [
  { type: "sent", label: "Food Stand A", amountKobo: 50000, time: "2 min ago", status: "pending" },
  { type: "sent", label: "Campus Bookshop", amountKobo: 150000, time: "1 hour ago", status: "confirmed" },
  { type: "topup", label: "Top-up via Korapay", amountKobo: 500000, time: "Yesterday", status: "confirmed" },
  { type: "sent", label: "Cafeteria Block B", amountKobo: 35000, time: "Yesterday", status: "confirmed" },
];

export default function HomeScreen(): React.ReactElement {
  const { state, signOut } = useAuth();
  const router = useRouter();

  if (state.status !== "authed") {
    return <View />;
  }

  const user = state.user;
  const jwtFresh = state.jwtFresh;

  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user.role === "MERCHANT") {
        const pending = listPendingByStatus("pending_reconciliation", "incoming");
        setPendingCount(pending.length);
      }
    }, [user.role])
  );

  const handleSync = async () => {
    setIsSyncing(true);
    await syncPendingEnvelopes();
    const pending = listPendingByStatus("pending_reconciliation", "incoming");
    setPendingCount(pending.length);
    setIsSyncing(false);
  };

  const balanceKobo = Number(user.verifiedBalanceKobo);
  const capRemainingNaira = ((MAX_USER_BALANCE_KOBO - balanceKobo) / 100).toFixed(0);

  const email = user.email || "";
  const firstName = email.split("@")[0]?.split(".")[0] || "there";
  const capName = firstName.charAt(0).toUpperCase() + firstName.slice(1);

  const totalPayments = 12;

  if (user.role === "STUDENT") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.nameText}>{capName} 👋</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.settingsButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/(app)/settings")}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Text style={styles.settingsIcon}>⚙</Text>
            </Pressable>
          </View>

          {/* Stale JWT Banner */}
          {!jwtFresh && (
            <View style={styles.staleBanner}>
              <Text style={styles.staleBannerText}>
                Sign in again to top up or see your latest balance.
              </Text>
            </View>
          )}

          {/* Balance Card */}
          <View style={styles.balanceCard}>
            {/* Pixel corner decoration */}
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
                <Text style={styles.balanceLabel}>Total Balance</Text>
                <Text style={styles.balanceAmount}>{formatNaira(balanceKobo)}</Text>
                <Text style={styles.balanceUpdated}>
                  {jwtFresh ? "✓ Updated just now" : "Last known balance"}
                </Text>
              </View>
              {/* Connectivity dot */}
              <View style={[styles.connectDot, !jwtFresh && styles.connectDotStale]} />
            </View>

            {/* Badges */}
            <View style={styles.badgeRow}>
              <View style={styles.paymentsBadge}>
                <Text style={styles.badgeText}>{totalPayments} PAYMENTS</Text>
              </View>
            </View>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionButtonPrimary,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/(app)/pay/scan")}
              accessibilityRole="button"
            >
              <Text style={styles.actionIcon}>📷</Text>
              <Text style={styles.actionTextPrimary}>Pay</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionButtonSecondary,
                pressed && styles.buttonPressed,
                !jwtFresh && styles.buttonDisabled,
              ]}
              onPress={() => router.push("/(app)/topup/amount")}
              accessibilityRole="button"
              disabled={!jwtFresh}
            >
              <Text style={styles.actionIcon}>↓</Text>
              <Text style={styles.actionTextSecondary}>Top Up</Text>
            </Pressable>
          </View>

          {/* Recent Activity */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <Pressable onPress={() => router.push("/(app)/history")}>
                <Text style={styles.seeAllLink}>See All →</Text>
              </Pressable>
            </View>

            <View style={styles.activityCard}>
              {SAMPLE_TXN.map((tx, i) => (
                <TxnItem key={i} {...tx} />
              ))}
            </View>
          </View>

          {/* Milestone Card */}
          {totalPayments >= 10 && totalPayments < 25 && (
            <View style={styles.milestoneCard}>
              <Text style={styles.milestoneIcon}>🎯</Text>
              <View style={styles.milestoneBody}>
                <Text style={styles.milestoneLabel}>MILESTONE</Text>
                <Text style={styles.milestoneText}>
                  {totalPayments} payments! You're a regular.
                </Text>
              </View>
            </View>
          )}

          {/* Bottom actions */}
          <View style={styles.bottomActions}>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryAction,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/(app)/change-pin")}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryActionText}>Change PIN</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.signOutButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => void signOut()}
              accessibilityRole="button"
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MERCHANT VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.welcomeText}>Welcome back,</Text>
            <Text style={styles.nameText}>{capName} 🏪</Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push("/(app)/settings")}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </Pressable>
        </View>

        {/* Stale JWT Banner */}
        {!jwtFresh && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleBannerText}>
              Sign in again to cash out or see your latest balance.
            </Text>
          </View>
        )}

        {/* Balance Card */}
        <View style={styles.balanceCard}>
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
              <Text style={styles.balanceLabel}>Total Balance</Text>
              <Text style={styles.balanceAmount}>{formatNaira(balanceKobo)}</Text>
              <Text style={styles.balanceUpdated}>
                {jwtFresh ? "✓ Updated just now" : "Last known balance"}
              </Text>
            </View>
            <View style={[styles.connectDot, !jwtFresh && styles.connectDotStale]} />
          </View>

          <View style={styles.badgeRow}>
            <View style={styles.merchantBadge}>
              <Text style={styles.badgeText}>MERCHANT</Text>
            </View>
          </View>
        </View>

        {/* Sync Card */}
        <View style={styles.syncCard}>
          <View>
            <Text style={styles.syncTitle}>Pending Syncs</Text>
            <Text style={styles.syncCount}>{pendingCount} payments</Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.syncButton,
              pressed && styles.buttonPressed,
              (isSyncing || pendingCount === 0 || !jwtFresh) && styles.buttonDisabled,
            ]}
            onPress={handleSync}
            disabled={isSyncing || pendingCount === 0 || !jwtFresh}
          >
            <Text style={styles.syncButtonText}>
              {isSyncing ? "Syncing..." : "Sync Now"}
            </Text>
          </Pressable>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              styles.actionButtonPrimary,
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
              pressed && styles.buttonPressed,
              !jwtFresh && styles.buttonDisabled,
            ]}
            onPress={() => router.push("/(app)/merchant/cashout")}
            accessibilityRole="button"
            disabled={!jwtFresh}
          >
            <Text style={styles.actionIcon}>↑</Text>
            <Text style={styles.actionTextSecondary}>Cash Out</Text>
          </Pressable>
        </View>

        {/* Actions List */}
        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [
              styles.listItem,
              pressed && styles.listItemPressed,
            ]}
            onPress={() => router.push("/(app)/merchant/cashout-history")}
            disabled={!jwtFresh}
          >
            <Text style={styles.listItemText}>Cashout History</Text>
            <Text style={styles.listItemArrow}>→</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.listItem,
              pressed && styles.listItemPressed,
            ]}
            onPress={() => router.push("/(app)/history")}
          >
            <Text style={styles.listItemText}>Transaction History</Text>
            <Text style={styles.listItemArrow}>→</Text>
          </Pressable>
        </View>

        {/* Bottom actions */}
        <View style={styles.bottomActions}>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryAction,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push("/(app)/change-pin")}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryActionText}>Change PIN</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => void signOut()}
            accessibilityRole="button"
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.light.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing["3xl"],
  },

  // Header
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
    color: colors.light.textSec,
  },
  nameText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    color: colors.light.text,
    marginTop: 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  settingsIcon: {
    fontSize: 18,
    color: colors.light.text,
  },

  // Stale Banner
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

  // Balance Card
  balanceCard: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    position: "relative",
    overflow: "hidden",
    ...shadows.neu.light,
  },
  pixelCorner: {
    position: "absolute",
    top: 0,
    right: 0,
    opacity: 0.08,
  },
  pixelRow: {
    flexDirection: "row",
  },
  pixelDot: {
    width: 8,
    height: 8,
    backgroundColor: "transparent",
  },
  pixelDotFilled: {
    backgroundColor: colors.primary,
  },
  balanceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  balanceLabel: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
    color: colors.light.textSec,
  },
  balanceAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.balance,
    color: colors.light.text,
    marginTop: spacing.xs,
    letterSpacing: -1,
  },
  balanceUpdated: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.light.textMut,
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

  // Quick Actions
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
    borderColor: colors.light.border,
    ...shadows.neu.light,
  },
  actionButtonSecondary: {
    backgroundColor: "transparent",
    borderColor: colors.light.border,
    ...shadows.neu.light,
  },
  actionIcon: {
    fontSize: 20,
  },
  actionTextPrimary: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  actionTextSecondary: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.light.text,
  },

  // Section
  section: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.sectionGap,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sectionTitle,
    color: colors.light.text,
  },
  seeAllLink: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.caption,
    color: colors.primary,
  },

  // Activity Card
  activityCard: {
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    ...shadows.neu.light,
  },

  // Transaction Item
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
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
  },
  txnIconText: {
    fontSize: 18,
    fontWeight: "800",
  },
  txnBody: {
    flex: 1,
  },
  txnLabel: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.light.text,
  },
  txnTime: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.light.textSec,
    marginTop: 2,
  },
  txnRight: {
    alignItems: "flex-end",
  },
  txnAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
  },
  txnStatus: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    color: colors.light.textMut,
    marginTop: 1,
  },

  // Milestone Card
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
    ...shadows.neu.light,
  },
  milestoneIcon: {
    fontSize: 28,
  },
  milestoneBody: {
    flex: 1,
  },
  milestoneLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.secondary,
  },
  milestoneText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.light.text,
    marginTop: spacing.xs,
  },

  // Sync Card (Merchant)
  syncCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
    ...shadows.neu.light,
  },
  syncTitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
  },
  syncCount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    color: colors.light.text,
    marginTop: spacing.xs,
  },
  syncButton: {
    backgroundColor: colors.light.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  syncButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.light.bg,
  },

  // List Items (Merchant)
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
    marginBottom: spacing.md,
    ...shadows.neu.light,
  },
  listItemPressed: {
    transform: [{ translateX: 2 }, { translateY: 2 }],
    shadowOffset: { width: 0, height: 0 },
  },
  listItemText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.bodyLg,
    color: colors.light.text,
  },
  listItemArrow: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
    color: colors.light.textMut,
  },

  // Bottom Actions
  bottomActions: {
    marginHorizontal: spacing.xl,
    marginTop: spacing["3xl"],
    gap: spacing.md,
  },
  secondaryAction: {
    height: 52,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.pill,
    backgroundColor: colors.light.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  secondaryActionText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.button,
    color: colors.light.text,
  },
  signOutButton: {
    height: 52,
    borderWidth: borders.standard,
    borderColor: colors.error,
    borderRadius: radii.pill,
    backgroundColor: colors.error + "10",
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.error,
  },

  // Shared
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
