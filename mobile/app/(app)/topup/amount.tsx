import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../../src/auth/auth-state";
import {
  requestTopup,
  MIN_TOPUP_KOBO,
  MAX_TOPUP_KOBO,
  TopupAmountError,
} from "../../../src/payment/topup-flow";
import { ApiError } from "../../../src/api/errors";
import {
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
  shadows,
  dimensions,
} from "../../../src/theme/tokens";

const PRESETS = [500, 1000, 2000, 5000];

function formatNaira(kobo: number): string {
  return "₦" + (kobo / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function TopupAmountScreen(): React.ReactElement {
  const router = useRouter();
  const { state } = useAuth();
  const [amountStr, setAmountStr] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const jwtFresh = state.status === "authed" && state.jwtFresh;
  const user = state.status === "authed" ? state.user : null;
  const balanceKobo = user ? Number(user.verifiedBalanceKobo) : 0;

  // Parse amount
  const amountNgn = parseFloat(amountStr) || 0;
  const amountKobo = Math.round(amountNgn * 100);
  const newBalanceKobo = balanceKobo + amountKobo;

  // Validation
  const isValidAmount = amountKobo >= MIN_TOPUP_KOBO && amountKobo <= MAX_TOPUP_KOBO;
  const hasInput = amountStr.length > 0;
  const showError = hasInput && !isValidAmount;

  if (!jwtFresh) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.notAuthContainer}>
          <Text style={styles.notAuthIcon}>🔒</Text>
          <Text style={styles.notAuthTitle}>Sign In Required</Text>
          <Text style={styles.notAuthText}>
            Please sign in to top up your balance.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.notAuthButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.back()}
          >
            <Text style={styles.notAuthButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const handleTopup = async () => {
    if (!isValidAmount) {
      Alert.alert("Invalid Amount", `Enter between ₦${MIN_TOPUP_KOBO / 100} and ₦${(MAX_TOPUP_KOBO / 100).toLocaleString()}`);
      return;
    }

    setLoading(true);
    try {
      const res = await requestTopup(amountKobo);
      router.push({
        pathname: "/(app)/topup/checkout",
        params: { paymentUrl: res.paymentUrl, reference: res.reference },
      });
    } catch (err) {
      if (err instanceof TopupAmountError) {
        Alert.alert("Invalid Amount", err.message);
      } else if (err instanceof ApiError) {
        Alert.alert("Error", err.message);
      } else if (err instanceof Error) {
        Alert.alert("Error", err.message);
      } else {
        Alert.alert("Error", "An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (naira: number) => {
    setAmountStr(String(naira));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
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
        <Text style={styles.headerTitle}>Top Up</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Current Balance</Text>
          <Text style={styles.balanceAmount}>{formatNaira(balanceKobo)}</Text>
        </View>

        {/* Amount Input */}
        <Text style={styles.inputLabel}>Enter amount</Text>
        <View
          style={[
            styles.inputContainer,
            inputFocused && styles.inputContainerFocused,
            showError && styles.inputContainerError,
          ]}
        >
          <Text style={styles.inputIcon}>₦</Text>
          <TextInput
            style={styles.input}
            value={amountStr}
            onChangeText={(t) => setAmountStr(t.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            placeholderTextColor={colors.light.textMut}
            keyboardType="decimal-pad"
            editable={!loading}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />
        </View>

        {showError && (
          <Text style={styles.errorText}>
            Min ₦{MIN_TOPUP_KOBO / 100}, Max ₦{(MAX_TOPUP_KOBO / 100).toLocaleString()}
          </Text>
        )}

        {/* Presets */}
        <View style={styles.presetsRow}>
          {PRESETS.map((p) => {
            const isActive = amountStr === String(p);
            return (
              <Pressable
                key={p}
                style={[
                  styles.presetChip,
                  isActive && styles.presetChipActive,
                ]}
                onPress={() => handlePreset(p)}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    isActive && styles.presetChipTextActive,
                  ]}
                >
                  {formatNaira(p * 100)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* New Balance Preview */}
        {amountKobo > 0 && (
          <View style={styles.previewCard}>
            <Text style={styles.previewLabel}>New balance</Text>
            <Text style={styles.previewAmount}>{formatNaira(newBalanceKobo)}</Text>
          </View>
        )}

        <View style={styles.spacer} />

        {/* Continue Button */}
        <Pressable
          style={({ pressed }) => [
            styles.continueButton,
            pressed && styles.buttonPressed,
            (!isValidAmount || loading) && styles.buttonDisabled,
          ]}
          onPress={handleTopup}
          disabled={!isValidAmount || loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.continueButtonText}>Continue to Payment</Text>
          )}
        </Pressable>
      </ScrollView>
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

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing.sm,
    paddingBottom: spacing["2xl"],
  },

  // Balance Card
  balanceCard: {
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPadLg,
    alignItems: "center",
    marginBottom: spacing["2xl"],
    ...shadows.neu.light,
  },
  balanceLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: colors.light.textSec,
  },
  balanceAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    color: colors.light.text,
    marginTop: spacing.xs,
    letterSpacing: -1,
  },

  // Input
  inputLabel: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
    color: colors.light.text,
    marginBottom: spacing.md,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.light.inputBg,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputContainerFocused: {
    borderColor: colors.primary,
  },
  inputContainerError: {
    borderColor: colors.error,
  },
  inputIcon: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.cardTitle,
    color: colors.light.textSec,
  },
  input: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.input,
    color: colors.light.text,
    padding: 0,
  },
  errorText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.error,
    marginTop: spacing.sm,
  },

  // Presets
  presetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  presetChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.card,
  },
  presetChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "20",
  },
  presetChipText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.body,
    color: colors.light.text,
  },
  presetChipTextActive: {
    color: colors.primary,
  },

  // Preview Card
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.primary + "12",
    borderWidth: borders.thin,
    borderColor: colors.primary + "30",
  },
  previewLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.light.textSec,
  },
  previewAmount: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sectionTitle,
    color: colors.primary,
  },

  spacer: {
    height: spacing["4xl"],
  },

  // Continue Button
  continueButton: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  continueButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },

  // Not Auth Screen
  notAuthContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  notAuthIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  notAuthTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    color: colors.light.text,
    marginBottom: spacing.sm,
  },
  notAuthText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  notAuthButton: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    backgroundColor: colors.light.card,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    ...shadows.neu.light,
  },
  notAuthButtonText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.button,
    color: colors.light.text,
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
