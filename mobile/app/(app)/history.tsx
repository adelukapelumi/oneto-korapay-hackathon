import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth/auth-state";
import { fetchLedger, LedgerEntry } from "../../src/api/ledger";
import {
  buildTransactionDisplayRows,
  getCachedMerchantLabelsByUserId,
  type TransactionDisplayRow,
} from "../../src/payment/transaction-list";
import { BackButton } from "../../components/BackButton";
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

type TxnType = "credit" | "debit";

function formatNaira(kobo: number | bigint): string {
  return "₦" + (Number(kobo) / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function TxnIcon({ type, theme }: { type: TxnType; theme: ReturnType<typeof getTheme> }): React.ReactElement {
  const isCredit = type === "credit";
  const bgColor = isCredit ? colors.primary + "18" : colors.error + "18";
  const iconColor = isCredit ? colors.primary : colors.error;

  return (
    <View style={[styles.txnIcon, { backgroundColor: bgColor, borderColor: theme.border }]}>
      <Text style={[styles.txnIconText, { color: iconColor }]}>
        {isCredit ? "↓" : "↑"}
      </Text>
    </View>
  );
}

export default function HistoryScreen(): React.ReactElement {
  const router = useRouter();
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  if (state.status !== "authed") {
    return <View />;
  }

  const jwtFresh = state.jwtFresh;

  const [serverEntries, setServerEntries] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (refresh: boolean = false) => {
      if (!jwtFresh) return;

      try {
        if (refresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const cursorToUse = refresh ? undefined : nextCursor || undefined;

        if (!refresh && serverEntries.length > 0 && !nextCursor) {
          return;
        }

        const res = await fetchLedger(cursorToUse, 20);

        if (refresh) {
          setServerEntries(res.entries);
        } else {
          setServerEntries((prev) => [...prev, ...res.entries]);
        }
        setNextCursor(res.nextCursor);
        setError(null);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load history";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [jwtFresh, nextCursor, serverEntries.length]
  );

  useEffect(() => {
    if (jwtFresh) {
      loadData(true);
    }
  }, [jwtFresh]);

  const displayTransactions = buildTransactionDisplayRows(serverEntries, {
    merchantLabelsByUserId: getCachedMerchantLabelsByUserId(),
  });

  const renderItem = ({ item }: { item: TransactionDisplayRow }) => {
    const isCredit = item.amountDirection === "credit";
    const txnType: TxnType = isCredit ? "credit" : "debit";
    const sign = isCredit ? "+" : "−";

    const dateStr = new Date(item.createdAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const statusIcon =
      item.statusIcon === "hourglass"
        ? "⏳"
        : item.statusIcon === "x"
          ? "✗"
          : item.statusIcon === "released"
            ? "↺"
            : "✓";
    const statusColor =
      item.statusTone === "pending"
        ? colors.secondary
        : item.statusTone === "rejected"
          ? colors.error
          : colors.primary;

    return (
      <View style={[styles.txnItem, { borderBottomColor: t.border + "40" }]}>
        <TxnIcon type={txnType} theme={t} />
        <View style={styles.txnBody}>
          <Text style={[styles.txnLabel, { color: t.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.txnTime, { color: t.textSec }]}>{dateStr}</Text>
        </View>
        <View style={styles.txnRight}>
          <Text
            style={[
              styles.txnAmount,
              { color: isCredit ? colors.primary : colors.error },
            ]}
          >
            {sign}{formatNaira(item.amountKobo)}
          </Text>
          <Text style={[styles.txnStatus, { color: statusColor }]}>
            {statusIcon} {item.statusLabel}
          </Text>
        </View>
      </View>
    );
  };

  const ListHeader = () => (
    <>
      {!jwtFresh && (
        <View style={styles.staleBanner}>
          <Text style={styles.staleBannerText}>
            Showing offline transactions. Sign in to see full history.
          </Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}
    </>
  );

  const ListFooter = () => {
    if (loading && !refreshing) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (!loading && !nextCursor && displayTransactions.length > 0) {
      return (
        <View style={styles.endOfHistory}>
          <Text style={[styles.endOfHistoryText, { color: t.textMut }]}>END OF HISTORY</Text>
        </View>
      );
    }

    return null;
  };

  const ListEmpty = () => {
    if (loading || refreshing) return null;

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={[styles.emptyTitle, { color: t.text }]}>No Transactions</Text>
        <Text style={[styles.emptyText, { color: t.textSec }]}>
          Your transaction history will appear here.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Transaction History</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={displayTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            enabled={jwtFresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        onEndReached={() => {
          if (jwtFresh && nextCursor && !loading) {
            loadData(false);
          }
        }}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },

  // Header
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
  headerSpacer: {
    width: dimensions.headerBackButton.size,
  },

  // Banners
  staleBanner: {
    backgroundColor: colors.secondary + "20",
    borderWidth: borders.thin,
    borderColor: colors.secondary + "60",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  staleBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: "#7a4d00",
    textAlign: "center",
  },
  errorBanner: {
    backgroundColor: colors.error + "15",
    borderWidth: borders.thin,
    borderColor: colors.error + "30",
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },

  // List
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
  },

  // Transaction Item
  txnItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  txnIcon: {
    width: dimensions.txnIcon.size,
    height: dimensions.txnIcon.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
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
  },
  txnTime: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
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
    marginTop: 2,
  },

  // Footer
  footerLoader: {
    paddingVertical: spacing["2xl"],
    alignItems: "center",
  },
  endOfHistory: {
    paddingVertical: spacing["4xl"],
    alignItems: "center",
  },
  endOfHistoryText: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
  },

  // Empty State
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing["6xl"],
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    textAlign: "center",
  },
});
