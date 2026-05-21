import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { MAX_OFFLINE_TRANSACTION_KOBO } from "@oneto/shared";
import { useAuth } from "../../../src/auth/auth-state";
import { fetchActiveMerchants } from "../../../src/api/merchants";
import {
  listCachedMerchants,
  replaceCachedMerchants,
} from "../../../src/ledger/db";
import { createPaymentRequest } from "../../../src/payment/create-request";
import { logger } from "../../../src/lib/logger";
import { BackButton } from "../../../components/BackButton";
import { useThemeMode } from "../../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
  dimensions,
} from "../../../src/theme/tokens";

interface MerchantOption {
  readonly userId: string;
  readonly label: string;
}

function parseAmountInputToKobo(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Allow only digits with optional 1-2 decimal places.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholeRaw = "0", fracRaw = ""] = trimmed.split(".");
  const whole = Number.parseInt(wholeRaw, 10);
  if (!Number.isFinite(whole) || whole < 0) return null;

  const fracPadded = (fracRaw + "00").slice(0, 2);
  const frac = Number.parseInt(fracPadded, 10);
  if (!Number.isFinite(frac) || frac < 0 || frac > 99) return null;

  const kobo = whole * 100 + frac;
  return Number.isInteger(kobo) ? kobo : null;
}

function formatNaira(kobo: number): string {
  return (
    "NGN " +
    (kobo / 100).toLocaleString("en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function ScanScreen(): React.ReactElement | null {
  const router = useRouter();
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(
    null,
  );
  const [amountInput, setAmountInput] = useState("");
  const [loadingMerchants, setLoadingMerchants] = useState(false);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthed = state.status === "authed";
  const jwtFresh = isAuthed ? state.jwtFresh : false;

  useFocusEffect(
    useCallback(() => {
      const cached = listCachedMerchants().map((m) => ({
        userId: m.userId,
        label: m.label,
      }));
      setMerchants(cached);
      setError(null);

      if (!isAuthed || !jwtFresh) return;

      setLoadingMerchants(true);
      void (async () => {
        try {
          const fresh = await fetchActiveMerchants();
          const mapped = fresh.map((m) => ({
            userId: m.id,
            label: m.label,
          }));
          replaceCachedMerchants(mapped);
          setMerchants(mapped);
        } catch (err) {
          logger.info("Merchant refresh failed, using cached list", err);
        } finally {
          setLoadingMerchants(false);
        }
      })();
    }, [isAuthed, jwtFresh]),
  );

  const amountKobo = useMemo(() => parseAmountInputToKobo(amountInput), [
    amountInput,
  ]);

  if (!isAuthed) {
    return null;
  }

  const selectedMerchant =
    selectedMerchantId === null
      ? null
      : merchants.find((m) => m.userId === selectedMerchantId) ?? null;

  const canContinue =
    selectedMerchant !== null &&
    amountKobo !== null &&
    amountKobo > 0 &&
    amountKobo <= MAX_OFFLINE_TRANSACTION_KOBO &&
    !creatingRequest;

  const handleContinue = async (): Promise<void> => {
    if (!selectedMerchant || amountKobo === null) return;

    if (amountKobo <= 0 || amountKobo > MAX_OFFLINE_TRANSACTION_KOBO) {
      setError(
        `Amount must be between NGN 0.01 and ${formatNaira(MAX_OFFLINE_TRANSACTION_KOBO)}.`,
      );
      return;
    }

    setError(null);
    setCreatingRequest(true);
    try {
      const request = await createPaymentRequest(
        selectedMerchant.userId,
        amountKobo,
        selectedMerchant.label,
      );
      router.push({
        pathname: "/(app)/pay/confirm",
        params: { request: JSON.stringify(request) },
      });
    } catch (err) {
      logger.info("Failed to create local payment request", err);
      setError("Could not create payment request. Try again.");
    } finally {
      setCreatingRequest(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Pay Merchant</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.border },
            t.shadow,
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>
              Select Merchant
            </Text>
            {loadingMerchants && (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
          </View>

          {merchants.length === 0 ? (
            <Text style={[styles.emptyText, { color: t.textSec }]}>
              No cached merchants yet. Connect to the internet to refresh.
            </Text>
          ) : (
            <View style={styles.merchantList}>
              {merchants.map((merchant) => {
                const selected = merchant.userId === selectedMerchantId;
                return (
                  <Pressable
                    key={merchant.userId}
                    style={({ pressed }) => [
                      styles.merchantItem,
                      {
                        borderColor: selected ? colors.primary : t.border,
                        backgroundColor: selected ? colors.primary + "12" : t.card,
                      },
                      pressed && styles.itemPressed,
                    ]}
                    onPress={() => {
                      setSelectedMerchantId(merchant.userId);
                      setError(null);
                    }}
                  >
                    <Text style={[styles.merchantName, { color: t.text }]}>
                      {merchant.label}
                    </Text>
                    <Text style={[styles.merchantId, { color: t.textMut }]}>
                      {merchant.userId}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.border },
            t.shadow,
          ]}
        >
          <Text style={[styles.sectionTitle, { color: t.text }]}>Amount</Text>
          <TextInput
            style={[
              styles.amountInput,
              { color: t.text, borderBottomColor: t.border },
            ]}
            value={amountInput}
            onChangeText={(text) => {
              setAmountInput(text);
              setError(null);
            }}
            placeholder="0.00"
            placeholderTextColor={t.textMut}
            keyboardType="decimal-pad"
          />
          <Text style={[styles.helperText, { color: t.textSec }]}>
            Max offline amount: {formatNaira(MAX_OFFLINE_TRANSACTION_KOBO)}
          </Text>
          {amountKobo !== null && amountKobo > 0 ? (
            <Text style={[styles.previewText, { color: t.text }]}>
              You will pay {formatNaira(amountKobo)}
            </Text>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.continueButton,
            { borderColor: t.border },
            !canContinue && styles.disabledButton,
            pressed && canContinue && styles.buttonPressed,
          ]}
          disabled={!canContinue}
          onPress={() => void handleContinue()}
        >
          <Text style={styles.continueText}>
            {creatingRequest ? "Preparing..." : "Continue"}
          </Text>
        </Pressable>
      </ScrollView>
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
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.screenHorizontal,
    paddingBottom: spacing["3xl"],
    gap: spacing.lg,
  },
  card: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  merchantList: {
    gap: spacing.sm,
  },
  merchantItem: {
    borderWidth: borders.standard,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  merchantName: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
  },
  merchantId: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  amountInput: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2,
    borderBottomWidth: borders.thin,
    paddingVertical: spacing.sm,
  },
  helperText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    marginTop: spacing.sm,
  },
  previewText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    marginTop: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.error + "20",
    borderWidth: borders.thin,
    borderColor: colors.error + "40",
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.sm,
    color: colors.error,
  },
  continueButton: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  itemPressed: {
    opacity: 0.75,
  },
});
