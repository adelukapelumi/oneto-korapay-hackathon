import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  type RecoveryReason,
  type RecoveryRiskType,
  createRecoveryRequest,
} from "../../src/api/recovery";
import { NetworkError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/auth-state";
import { getPendingRecoveryPublicKey } from "../../src/crypto/pin-derive";
import {
  RECOVERY_REASON_OPTIONS,
  RECOVERY_REQUEST_WARNINGS,
} from "../../src/recovery/recovery-ui";
import { useThemeMode } from "../../src/theme/theme-provider";
import {
  borders,
  colors,
  fontSizes,
  fonts,
  getTheme,
  radii,
  spacing,
} from "../../src/theme/tokens";

function sanitizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeOptionalKobo(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Money fields must be whole kobo amounts.");
  }
  return parsed;
}

export default function RecoveryRequestScreen(): React.ReactElement {
  const router = useRouter();
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const params = useLocalSearchParams<{ riskType?: string }>();
  const defaultRiskType: RecoveryRiskType =
    params.riskType === "COMPROMISED_DEVICE"
      ? "COMPROMISED_DEVICE"
      : "LOST_DEVICE";

  const [riskType, setRiskType] = useState<RecoveryRiskType>(defaultRiskType);
  const [reason, setReason] = useState<RecoveryReason>(
    defaultRiskType === "COMPROMISED_DEVICE" ? "STOLEN_PHONE" : "NEW_PHONE",
  );
  const [approximateBalanceKobo, setApproximateBalanceKobo] = useState("");
  const [lastMerchantText, setLastMerchantText] = useState("");
  const [lastTopupAmountKobo, setLastTopupAmountKobo] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heading = useMemo(
    () =>
      riskType === "COMPROMISED_DEVICE"
        ? {
            title: "Secure your Oneto account",
            body:
              "If your phone was stolen or someone may know your PIN, we'll block the old phone.",
          }
        : {
            title: "Recover your Oneto account",
            body:
              "We'll help you set up Oneto on this phone. Tell us what happened so support can review it safely.",
          },
    [riskType],
  );

  const userEmail =
    state.status === "onboarding" || state.status === "recovery_pending"
      ? state.user.email
      : "";

  async function submit(): Promise<void> {
    setIsSubmitting(true);
    setError(null);

    try {
      const requestedNewPublicKey = await getPendingRecoveryPublicKey();
      if (!requestedNewPublicKey) {
        setError("Recovery key missing. Contact support.");
        return;
      }

      const whatHappened = sanitizeOptionalText(userNotes);
      if (!whatHappened) {
        setError('"What happened?" is required.');
        return;
      }

      // Recovery only sends account-history hints plus the pending public key.
      // The PIN never leaves this phone.
      const request = await createRecoveryRequest({
        requestedNewPublicKey,
        riskType,
        reason,
        approximateBalanceKobo: sanitizeOptionalKobo(approximateBalanceKobo),
        lastMerchantText: sanitizeOptionalText(lastMerchantText),
        lastTopupAmountKobo: sanitizeOptionalKobo(lastTopupAmountKobo),
        userNotes: whatHappened,
      });

      if (request.status === "PENDING") {
        router.replace("/(onboarding)/recovery-pending");
        return;
      }

      router.replace("/(onboarding)/recovery-pending");
    } catch (err) {
      if (err instanceof NetworkError) {
        setError(err.message);
        return;
      }
      if (err instanceof Error) {
        setError(err.message);
        return;
      }
      setError("Couldn't submit your recovery request. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen
      scroll
      keyboard
      contentContainerStyle={styles.content}
    >
      <View style={styles.container}>
        <View style={[styles.heroCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={styles.eyebrow}>RECOVERY</Text>
          <Text style={[styles.title, { color: t.text }]}>{heading.title}</Text>
          <Text style={[styles.body, { color: t.textSec }]}>{heading.body}</Text>
          <Text style={[styles.meta, { color: t.textMut }]}>
            Signed in as {userEmail || "your account"}
          </Text>
        </View>

        <View style={styles.toggleRow}>
          <ToggleButton
            label="Lost device"
            selected={riskType === "LOST_DEVICE"}
              onPress={() => {
                setRiskType("LOST_DEVICE");
                if (reason === "STOLEN_PHONE") {
                  setReason("NEW_PHONE");
                }
              }}
            />
          <ToggleButton
            label="Compromised device"
            selected={riskType === "COMPROMISED_DEVICE"}
            onPress={() => {
              setRiskType("COMPROMISED_DEVICE");
              setReason("STOLEN_PHONE");
            }}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.text }]}>What happened?</Text>
          <View style={styles.reasonGrid}>
            {RECOVERY_REASON_OPTIONS.map((option) => (
              <ReasonChip
                key={option.value}
                label={option.label}
                selected={reason === option.value}
                onPress={() => setReason(option.value)}
              />
            ))}
          </View>
          <InputField
            label="What happened?"
            value={userNotes}
            onChangeText={setUserNotes}
            multiline
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.text }]}>Optional details</Text>
          <InputField
            label="Approximate balance (kobo)"
            value={approximateBalanceKobo}
            onChangeText={setApproximateBalanceKobo}
            keyboardType="number-pad"
          />
          <InputField
            label="Last place you paid with Oneto"
            value={lastMerchantText}
            onChangeText={setLastMerchantText}
          />
          <InputField
            label="Last top-up amount (kobo)"
            value={lastTopupAmountKobo}
            onChangeText={setLastTopupAmountKobo}
            keyboardType="number-pad"
          />
        </View>

        <View style={[styles.warningCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
          <Text style={[styles.warningTitle, { color: t.text }]}>Important</Text>
          {RECOVERY_REQUEST_WARNINGS.map((line, index) => (
            <Text
              key={line}
              style={[
                index === 0 ? styles.warningFootnote : styles.warningBody,
                { color: index === 0 ? t.textMut : t.textSec },
              ]}
            >
              {line}
            </Text>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => {
            void submit();
          }}
          style={({ pressed }) => [
            styles.submitButton,
            { borderColor: t.border },
            pressed && !isSubmitting && styles.submitButtonPressed,
            isSubmitting && styles.submitButtonDisabled,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.primaryText} />
          ) : (
            <Text style={styles.submitButtonText}>Submit recovery request</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

function ToggleButton({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.toggleButton,
        {
          backgroundColor: selected ? colors.primary : t.cardAlt,
          borderColor: selected ? colors.primary : t.border,
        },
      ]}
    >
      <Text
        style={[
          styles.toggleButtonText,
          { color: selected ? colors.primaryText : t.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ReasonChip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.reasonChip,
        {
          backgroundColor: selected ? colors.secondary : t.cardAlt,
          borderColor: selected ? colors.secondary : t.border,
        },
      ]}
    >
      <Text
        style={[
          styles.reasonChipText,
          { color: selected ? "#1B1208" : t.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly keyboardType?: "default" | "number-pad";
  readonly multiline?: boolean;
}): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <View style={styles.inputWrap}>
      <Text style={[styles.inputLabel, { color: t.textSec }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          {
            color: t.text,
            backgroundColor: t.inputBg,
            borderColor: t.border,
            minHeight: multiline ? 120 : 52,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  container: {
    gap: spacing.lg,
  },
  heroCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: {
    fontFamily: fonts.pixel,
    fontSize: fontSizes.sm,
    color: colors.primary,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2,
    lineHeight: 34,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 24,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  toggleButton: {
    flex: 1,
    minHeight: 52,
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
  },
  toggleButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  reasonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reasonChip: {
    borderWidth: borders.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reasonChipText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
  },
  inputWrap: {
    gap: spacing.xs,
  },
  inputLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  input: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  warningCard: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  warningTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  warningBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 22,
  },
  warningFootnote: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: 20,
  },
  error: {
    color: colors.error,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  submitButton: {
    minHeight: 56,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  submitButtonPressed: {
    opacity: 0.92,
    transform: [{ translateY: 1 }],
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: colors.primaryText,
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
  },
});
