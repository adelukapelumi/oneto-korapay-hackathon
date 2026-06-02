import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../src/auth/auth-state";
import { getToken } from "../../src/auth/token-store";
import { env } from "../../src/lib/env";
import {
  getRecoveryStatus,
  shouldRedirectToRecoveryStatus,
} from "../../src/api/recovery";
import { NetworkError } from "../../src/api/errors";
import { logger } from "../../src/lib/logger";
import {
  getDeviceLinkedActions,
  SUPPORT_EMAIL_ADDRESS,
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

type ExistingRequestState =
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "network_error"; message: string };

export default function DeviceLinkedScreen(): React.ReactElement {
  const router = useRouter();
  const { state, resetLocalAppForTesting } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const recoveryActions = getDeviceLinkedActions(env.ENABLE_OLD_PHONE_APPROVAL);
  const [existingRequestState, setExistingRequestState] =
    useState<ExistingRequestState>({ kind: "checking" });
  const [reloadToken, setReloadToken] = useState(0);
  const [isResettingLocalApp, setIsResettingLocalApp] = useState(false);

  async function performFullLocalReset(): Promise<void> {
    if (isResettingLocalApp) {
      return;
    }

    setIsResettingLocalApp(true);
    try {
      await resetLocalAppForTesting();
      router.replace("/(auth)/sign-in");
    } catch {
      Alert.alert(
        "Reset failed",
        "Couldn't reset this device's local app state. Close and reopen the app, then try again.",
      );
    } finally {
      setIsResettingLocalApp(false);
    }
  }

  function confirmFullLocalReset(): void {
    if (isResettingLocalApp) {
      return;
    }

    Alert.alert(
      "TESTING ONLY: reset this app",
      "Testing only. Clears local Expo/iPhone app data for this device. It does not reset the backend account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset this app",
          style: "destructive",
          onPress: () => {
            void performFullLocalReset();
          },
        },
      ],
    );
  }

  useEffect(() => {
    void (async () => {
      const token = await getToken();
      logger.info("recovery_screen_auth_context", {
        screen: "device-linked",
        authStateStatus: state.status,
        tokenPresent: Boolean(token),
      });
    })();
  }, [state.status]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const request = await getRecoveryStatus();
        if (cancelled) return;
        if (shouldRedirectToRecoveryStatus(request)) {
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
            Tell us what happened so Oneto Support can safely move your account to this phone.
          </Text>
          <Text style={[styles.footer, { color: t.textMut }]}>
            Your request will be sent to Oneto Support at {SUPPORT_EMAIL_ADDRESS}.
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
          {recoveryActions.map((action, index) => (
            <ActionButton
              key={action.label}
              label={action.label}
              secondary={index > 0}
              onPress={() => {
                if (action.pathname === "/(onboarding)/move-device") {
                  router.push("/(onboarding)/move-device");
                  return;
                }

                router.push({
                  pathname: "/(onboarding)/recovery-request",
                  params: action.params,
                });
              }}
            />
          ))}
        </View>

        <View style={[styles.testingResetCard, { backgroundColor: t.cardAlt, borderColor: colors.error }]}>
          <Text style={styles.testingResetEyebrow}>TESTING ONLY</Text>
          <Text style={[styles.testingResetTitle, { color: t.text }]}>
            Testing only: reset this app
          </Text>
          <Text style={[styles.testingResetBody, { color: t.textSec }]}>
            Testing only. Clears local Expo/iPhone app data for this device. It does not reset the backend account.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isResettingLocalApp}
            onPress={confirmFullLocalReset}
            style={({ pressed }) => [
              styles.testingResetButton,
              isResettingLocalApp && styles.buttonDisabled,
              pressed && !isResettingLocalApp && styles.buttonPressed,
            ]}
          >
            <Text style={styles.testingResetButtonText}>
              {isResettingLocalApp ? "Resetting this app..." : "Testing only: reset this app"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function ActionButton({
  label,
  onPress,
  secondary = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
}): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary
          ? [styles.buttonSecondary, { borderColor: t.border, backgroundColor: t.cardAlt }]
          : [styles.buttonPrimary, { borderColor: t.border }],
        pressed && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary ? { color: t.text } : styles.buttonTextLight,
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
  buttonPressed: {
    opacity: 0.9,
    transform: [{ translateY: 1 }],
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    textAlign: "center",
  },
  buttonTextLight: {
    color: colors.primaryText,
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
  testingResetCard: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  testingResetEyebrow: {
    fontFamily: fonts.pixel,
    fontSize: fontSizes.sm,
    color: colors.error,
  },
  testingResetTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  testingResetBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 22,
  },
  testingResetButton: {
    minHeight: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.error,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  testingResetButtonText: {
    color: colors.primaryText,
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    textAlign: "center",
  },
});
