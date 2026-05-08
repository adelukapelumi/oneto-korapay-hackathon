import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/auth/auth-state";
import { fetchLedger, LedgerEntry } from "../../src/api/ledger";
import { mergeTransactions, DisplayTransaction } from "../../src/payment/transaction-list";

export default function HistoryScreen() {
  const { state } = useAuth();
  
  if (state.status !== "authed") {
    return <View />;
  }
  
  const jwtFresh = state.jwtFresh;
  
  const [serverEntries, setServerEntries] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (refresh: boolean = false) => {
    if (!jwtFresh) return; // offline
    
    try {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      
      const cursorToUse = refresh ? undefined : (nextCursor || undefined);
      
      // If we're not refreshing and there's no next cursor, don't fetch
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
    } catch (err: any) {
      setError(err.message || "Failed to load history");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jwtFresh, nextCursor, serverEntries.length]);

  useEffect(() => {
    if (jwtFresh) {
      loadData(true);
    }
  }, [jwtFresh]);

  const displayTransactions = mergeTransactions(serverEntries);

  const renderItem = ({ item }: { item: DisplayTransaction }) => {
    const isCredit = 
      (item.source === "server" && item.type === "CREDIT") ||
      (item.source === "local" && item.direction === "incoming");
      
    const isDebit = 
      (item.source === "server" && item.type === "DEBIT") ||
      (item.source === "local" && item.direction === "outgoing");

    const amountNaira = (Number(item.amountKobo) / 100).toFixed(2);
    const sign = isCredit ? "+" : "-";
    
    // Description or recipient label
    const label = item.source === "server" ? item.description : (item.recipientLabel || "Offline Transaction");
    
    // Date
    const dateStr = new Date(item.createdAt).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    let statusIndicator = null;
    let statusStyle = {};
    if (item.status === "confirmed" || item.status === "reconciled") {
      statusIndicator = "✓";
      statusStyle = { color: "#28a745" };
    } else if (item.status === "pending_reconciliation") {
      statusIndicator = "⏱";
      statusStyle = { color: "#ffc107" };
    } else if (item.status === "rejected") {
      statusIndicator = "✗";
      statusStyle = { color: "#dc3545" };
    }

    return (
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowDate}>{dateStr}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.rowAmount, isCredit ? styles.amountCredit : styles.amountDebit]}>
            {sign}₦{amountNaira}
          </Text>
          <View style={styles.statusContainer}>
            <Text style={[styles.statusText, statusStyle]}>{statusIndicator}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
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

      <FlatList
        data={displayTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadData(true)}
            enabled={jwtFresh}
          />
        }
        onEndReached={() => {
          if (jwtFresh && nextCursor && !loading) {
            loadData(false);
          }
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !loading && !refreshing ? (
            <Text style={styles.emptyText}>No transactions found.</Text>
          ) : null
        }
        ListFooterComponent={
          loading && !refreshing ? (
            <ActivityIndicator style={styles.footerLoader} />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  staleBanner: {
    backgroundColor: "#fff5e6",
    borderColor: "#ffb84d",
    borderWidth: 1,
    padding: 12,
  },
  staleBannerText: { color: "#7a4d00", fontSize: 13, textAlign: "center" },
  errorBanner: {
    backgroundColor: "#ffe6e6",
    padding: 12,
  },
  errorBannerText: { color: "#cc0000", fontSize: 13, textAlign: "center" },
  listContent: {
    padding: 16,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowLeft: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#000",
    marginBottom: 4,
  },
  rowDate: {
    fontSize: 13,
    color: "#666",
  },
  rowRight: {
    alignItems: "flex-end",
  },
  rowAmount: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  amountCredit: {
    color: "#28a745",
  },
  amountDebit: {
    color: "#000",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusText: {
    fontSize: 14,
    fontWeight: "bold",
  },
  emptyText: {
    textAlign: "center",
    color: "#888",
    marginTop: 40,
    fontSize: 15,
  },
  footerLoader: {
    marginVertical: 20,
  },
});
