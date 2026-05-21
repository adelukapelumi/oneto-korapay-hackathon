import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import { getRecoveryStatus } from "../../src/api/recovery";
import { NetworkError } from "../../src/api/errors";
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

type ExistingRequestState =
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "network_error"; message: string };

export default function DeviceLinkedScreen(): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [existingRequestState, setExistingRequestState] =
    useState<ExistingRequestState>({ kind: "checking" });
  const [showOldPhoneMessage, setShowOldPhoneMessage] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const request = await getRecoveryStatus();
        if (cancelled) return;
        if (request) {
          router.replace("/(onboarding)/recovery-pending");
          return;
        }
        setExistingRequestState({ kind: "idle" });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          setExistingRequestState({ kind: "network_error", message: err.message });
          return;
        }
        setExistingRequestState({
          kind: "network_error",
          message: "We couldn't check your recovery status. You can still continue.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken, router]);

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
    >
      <View style={styles.container}>
        <View style={[styles.heroCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={styles.eyebrow}>SECURE SETUP</Text>
          <Text style={[styles.title, { color: t.text }]}>
            This account is already linked to another phone
          </Text>
          <Text style={[styles.body, { color: t.textSec }]}>
            To protect your Oneto points, we need to confirm before setting up this phone.
          </Text>
          <Text style={[styles.footer, { color: t.textMut }]}>
            This helps stop someone from taking over your account with only your email.
          </Text>
        </View>

        {existingRequestState.kind === "checking" ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.inlineText, { color: t.textSec }]}>
              Checking your recovery status...
            </Text>
          </View>
        ) : null}

        {existingRequestState.kind === "network_error" ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeTitle, { color: t.text }]}>Couldn't check right now</Text>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              {existingRequestState.message}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setExistingRequestState({ kind: "checking" });
                setReloadToken((value) => value + 1);
              }}
            >
              <Text style={styles.retryLink}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actions}>
          <ActionButton
            label="I lost access to my old phone"
            onPress={() =>
              router.push({
                pathname: "/(onboarding)/recovery-request",
                params: { riskType: "LOST_DEVICE" },
              })
            }
          />
          <ActionButton
            label="My phone was stolen"
            secondary
            onPress={() =>
              router.push({
                pathname: "/(onboarding)/recovery-request",
                params: { riskType: "COMPROMISED_DEVICE" },
              })
            }
          />
          <ActionButton
            label="I still have my old phone"
            tertiary
            onPress={() => setShowOldPhoneMessage((value) => !value)}
          />
        </View>

        {showOldPhoneMessage ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeTitle, { color: t.text }]}>Moving from an old phone is coming next.</Text>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              For now, use recovery or contact support.
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
  tertiary = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
  readonly tertiary?: boolean;
}): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tertiary
          ? [styles.buttonTertiary, { borderColor: t.border, backgroundColor: t.cardAlt }]
          : secondary
            ? [styles.buttonSecondary, { borderColor: colors.secondary, backgroundColor: colors.secondary }]
            : [styles.buttonPrimary, { borderColor: t.border }],
        pressed && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tertiary ? { color: t.text } : secondary ? styles.buttonTextDark : styles.buttonTextLight,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  container: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
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
  footer: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: 20,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  inlineText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  actions: {
    gap: spacing.md,
  },
  button: {
    minHeight: 56,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {},
  buttonTertiary: {},
  buttonPressed: {
    opacity: 0.9,
    transform: [{ translateY: 1 }],
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    textAlign: "center",
  },
  buttonTextLight: {
    color: colors.primaryText,
  },
  buttonTextDark: {
    color: "#1B1208",
  },
  noticeCard: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  noticeTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  noticeBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 22,
  },
  retryLink: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
  },
});
