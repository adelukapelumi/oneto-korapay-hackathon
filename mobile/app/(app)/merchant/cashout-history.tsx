import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { getCashoutStatus, Cashout } from "../../../src/api/cashout";
import { ApiError } from "../../../src/api/errors";
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

export default function CashoutHistoryScreen(): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [cashouts, setCashouts] = useState<Cashout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setError(null);
    try {
      const data = await getCashoutStatus();
      setCashouts(data);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to fetch history");
      } else if (err instanceof Error) {
        setError(err.message || "An unexpected error occurred");
      } else {
        setError("An unexpected error occurred");
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

  const getStatusColors = (status: string) => {
    switch (status) {
      case "PENDING":
        return { bg: colors.secondary + "20", text: colors.secondary };
      case "PROCESSING":
        return { bg: colors.primary + "20", text: colors.primary };
      case "COMPLETED":
        return { bg: colors.primary + "20", text: colors.primary };
      case "FAILED":
        return { bg: colors.error + "20", text: colors.error };
      default:
        return { bg: t.cardAlt, text: t.textMut };
    }
  };

  const renderItem = ({ item }: { item: Cashout }) => {
    const amountNaira = (Number(item.amountKobo) / 100).toFixed(2);
    const dateStr = new Date(item.requestedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const statusColors = getStatusColors(item.status);

    return (
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.amount, { color: t.text }]}>₦{amountNaira}</Text>
          <View style={[styles.badge, { backgroundColor: statusColors.bg }]}>
            <Text style={[styles.badgeText, { color: statusColors.text }]}>{item.status}</Text>
          </View>
        </View>
        <Text style={[styles.date, { color: t.textSec }]}>{dateStr}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={[styles.backButton, { borderColor: t.border, backgroundColor: t.card }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.backIcon, { color: t.text }]}>←</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Cashout History</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.container}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} size="large" color={colors.primary} />
        ) : (
          <FlatList
            data={cashouts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            ListEmptyComponent={
              !error ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyIcon}>💸</Text>
                  <Text style={[styles.emptyTitle, { color: t.text }]}>No Cashouts</Text>
                  <Text style={[styles.emptyText, { color: t.textSec }]}>
                    Your cashout history will appear here.
                  </Text>
                </View>
              ) : null
            }
            ListFooterComponent={
              !loading && cashouts.length > 0 ? (
                <View style={styles.endOfList}>
                  <Text style={[styles.endOfListText, { color: t.textMut }]}>END OF HISTORY</Text>
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
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  backButton: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { fontSize: 18 },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
  },
  headerSpacer: { width: dimensions.headerBackButton.size },
  container: { flex: 1 },
  loader: { marginTop: spacing["4xl"] },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing["3xl"],
  },
  errorBox: {
    backgroundColor: colors.error + "15",
    borderWidth: borders.thin,
    borderColor: colors.error + "30",
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
    textAlign: "center",
  },
  card: {
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    borderWidth: borders.standard,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  badgeText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.xs,
  },
  date: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing["6xl"],
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.lg },
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
  endOfList: {
    paddingVertical: spacing["4xl"],
    alignItems: "center",
  },
  endOfListText: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
  },
});
