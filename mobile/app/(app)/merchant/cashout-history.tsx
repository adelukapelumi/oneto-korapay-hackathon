import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { getCashoutStatus, Cashout } from "../../../src/api/cashout";
import { ApiError } from "../../../src/api/errors";

export default function CashoutHistoryScreen(): React.ReactElement {
  const [cashouts, setCashouts] = useState<Cashout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setError(null);
    try {
      const data = await getCashoutStatus();
      setCashouts(data);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to fetch history");
      } else {
        setError(err.message || "An unexpected error occurred");
      }
    }
  };

  useEffect(() => {
    fetchHistory().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory().finally(() => setRefreshing(false));
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return { bg: "#fff5e6", text: "#ff8c00" }; // Yellow/Orange
      case "PROCESSING":
        return { bg: "#e3f2fd", text: "#1976d2" }; // Blue
      case "COMPLETED":
        return { bg: "#e8f5e9", text: "#2e7d32" }; // Green
      case "FAILED":
        return { bg: "#ffebee", text: "#c62828" }; // Red
      default:
        return { bg: "#f5f5f5", text: "#666666" }; // Gray
    }
  };

  const renderItem = ({ item }: { item: Cashout }) => {
    const amountNaira = (Number(item.amountKobo) / 100).toFixed(2);
    const date = new Date(item.requestedAt).toLocaleString();
    const colors = getStatusColor(item.status);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.amount}>₦{amountNaira}</Text>
          <View style={[styles.badge, { backgroundColor: colors.bg }]}>
            <Text style={[styles.badgeText, { color: colors.text }]}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.date}>{date}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <Stack.Screen options={{ title: "Cashout History", headerBackTitle: "Back" }} />
      <View style={styles.container}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} size="large" />
        ) : (
          <FlatList
            data={cashouts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              !error ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>No cashouts yet.</Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1 },
  loader: { marginTop: 40 },
  listContent: { padding: 16 },
  errorBox: {
    backgroundColor: "#ffebee",
    padding: 16,
    margin: 16,
    borderRadius: 8,
  },
  errorText: { color: "#c62828", fontSize: 14 },
  card: {
    backgroundColor: "#fff",
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  amount: { fontSize: 18, fontWeight: "600", color: "#000" },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  date: { fontSize: 14, color: "#888" },
  emptyBox: { padding: 32, alignItems: "center" },
  emptyText: { color: "#888", fontSize: 16 },
});
