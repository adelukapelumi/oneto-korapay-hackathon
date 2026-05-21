import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  cancelRecoveryRequest,
  getRecoveryStatus,
  type RecoveryRequest,
} from "../../src/api/recovery";
import { NetworkError } from "../../src/api/errors";
import {
  PinIncorrectError,
  PinLockedError,
  clearPendingRecoveryAttempts,
  getPendingRecoveryAttemptState,
  hasPendingRecoveryKeypair,
  loadAndDecryptPendingRecoveryKeypair,
  promotePendingRecoveryKeypair,
  recordPendingRecoveryWrongAttempt,
  wipePendingRecoveryKeypair,
} from "../../src/crypto/pin-derive";
import { describeAttemptState, formatMmSs } from "../../src/lib/pin-attempts";
import { useAuth } from "../../src/auth/auth-state";
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

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; request: RecoveryRequest | null }
  | { kind: "error"; message: string };

export default function RecoveryPendingScreen(): React.ReactElement {
  const router = useRouter();
  const {
    completeOnboarding,
    getPendingRecoveryKeypair,
    discardPendingRecoveryKeypair,
  } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [pin, setPin] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);

  async function refreshStatus(): Promise<void> {
    setLoadState({ kind: "loading" });
    try {
      const request = await getRecoveryStatus();
      setLoadState({ kind: "ready", request });
    } catch (err) {
      if (err instanceof NetworkError) {
        setLoadState({ kind: "error", message: err.message });
        return;
      }
      setLoadState({
        kind: "error",
        message: "Couldn't load your recovery status. Pull to retry.",
      });
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshLockState = async (): Promise<void> => {
      const state = await getPendingRecoveryAttemptState();
      if (cancelled) return;
      const display = describeAttemptState(state);
      setLockSecondsRemaining(display.lockSecondsRemaining);
    };

    void refreshLockState();
    const id = setInterval(() => void refreshLockState(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const request =
    loadState.kind === "ready" ? loadState.request : null;

  const description = useMemo(() => {
    if (!request) {
      return {
        title: "No recovery request found",
        body: "Start recovery from the previous screen if you still need to move this account.",
      };
    }
    switch (request.status) {
      case "PENDING":
        return {
          title: "Recovery request submitted",
          body: "We're reviewing your request. Payments may stay paused until your account is secured.",
        };
      case "APPROVED":
        return {
          title: "Recovery approved",
          body: "You can now activate Oneto on this phone.",
        };
      case "REJECTED":
        return {
          title: "Recovery could not be approved",
          body: "We could not confirm enough details to safely move your account.",
        };
      case "CANCELLED":
        return {
          title: "Recovery was cancelled",
          body: "This phone was not activated. Start a new recovery request if you still need help.",
        };
    }
  }, [request]);

  async function activateApprovedRecovery(): Promise<void> {
    if (!request || request.status !== "APPROVED" || isActivating) {
      return;
    }

    setIsActivating(true);
    setActionError(null);

    try {
      const pendingExists = await hasPendingRecoveryKeypair();
      if (!pendingExists) {
        setActionError("Recovery key missing. Contact support.");
        return;
      }

      const staged = getPendingRecoveryKeypair();
      const activatedKeypair = staged
        ? staged
        : await loadAndDecryptPendingRecoveryKeypair(pin);

      if (!staged) {
        await clearPendingRecoveryAttempts();
      }

      await promotePendingRecoveryKeypair();
      completeOnboarding(
        activatedKeypair.privateKey,
        activatedKeypair.publicKey,
      );
      router.replace("/(app)/home");
    } catch (err) {
      if (err instanceof PinLockedError) {
        const remaining = Math.max(
          0,
          Math.ceil((err.lockedUntilMs - Date.now()) / 1000),
        );
        setLockSecondsRemaining(remaining);
        setActionError(`Locked. Try again in ${formatMmSs(remaining)}.`);
        return;
      }
      if (err instanceof PinIncorrectError) {
        const result = await recordPendingRecoveryWrongAttempt();
        if (result.willWipe) {
          discardPendingRecoveryKeypair();
          await wipePendingRecoveryKeypair();
          setActionError("Recovery key missing. Contact support.");
          return;
        }
        const state = await getPendingRecoveryAttemptState();
        setActionError(describeAttemptState(state).message);
        setPin("");
        return;
      }
      if (err instanceof NetworkError) {
        setActionError(err.message);
        return;
      }
      if (err instanceof Error) {
        setActionError(err.message);
        return;
      }
      setActionError("Couldn't activate this phone. Try again.");
    } finally {
      setIsActivating(false);
    }
  }

  async function cancelPendingRecovery(): Promise<void> {
    if (!request || request.status !== "PENDING" || isCancelling) {
      return;
    }

    setIsCancelling(true);
    setActionError(null);

    try {
      await cancelRecoveryRequest(request.id);
      discardPendingRecoveryKeypair();
      await wipePendingRecoveryKeypair();
      await refreshStatus();
    } catch (err) {
      if (err instanceof NetworkError) {
        setActionError(err.message);
        return;
      }
      if (err instanceof Error) {
        setActionError(err.message);
        return;
      }
      setActionError("Couldn't cancel this recovery request.");
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <Screen scroll keyboard contentContainerStyle={styles.content}>
      <View style={styles.container}>
        <View style={[styles.heroCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={styles.eyebrow}>RECOVERY STATUS</Text>
          <Text style={[styles.title, { color: t.text }]}>{description.title}</Text>
          <Text style={[styles.body, { color: t.textSec }]}>{description.body}</Text>
          <Text style={[styles.warning, { color: t.textMut }]}>
            Do not uninstall Oneto or clear app data while recovery is pending.
          </Text>
        </View>

        {loadState.kind === "loading" ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: t.textSec }]}>Checking status...</Text>
          </View>
        ) : null}

        {loadState.kind === "error" ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>{loadState.message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void refreshStatus()}>
              <Text style={styles.linkText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {loadState.kind === "ready" && request?.status === "PENDING" ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeTitle, { color: t.text }]}>Review in progress</Text>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              We'll notify you when this phone can be activated. Need help? Contact support@getoneto.com.
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={isCancelling}
              onPress={() => {
                void cancelPendingRecovery();
              }}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: t.border, backgroundColor: t.bg },
                pressed && !isCancelling && styles.secondaryButtonPressed,
              ]}
            >
              {isCancelling ? (
                <ActivityIndicator size="small" color={t.text as string} />
              ) : (
                <Text style={[styles.secondaryButtonText, { color: t.text }]}>
                  Cancel request
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {loadState.kind === "ready" && request?.status === "APPROVED" ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeTitle, { color: t.text }]}>Activate this phone</Text>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              If you restarted the app, enter the PIN you created on this phone so we can unlock the stored recovery key.
            </Text>
            {!getPendingRecoveryKeypair() ? (
              <TextInput
                value={pin}
                onChangeText={setPin}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                placeholder="Enter your 6-digit PIN"
                placeholderTextColor={t.textMut as string}
                style={[
                  styles.pinInput,
                  {
                    color: t.text,
                    backgroundColor: t.inputBg,
                    borderColor: t.border,
                  },
                ]}
              />
            ) : (
              <Text style={[styles.noticeBody, { color: t.textSec }]}>
                This phone still has your recovery key in memory, so you can finish setup now.
              </Text>
            )}
            {lockSecondsRemaining > 0 ? (
              <Text style={styles.error}>
                Locked. Try again in {formatMmSs(lockSecondsRemaining)}.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={isActivating}
              onPress={() => {
                void activateApprovedRecovery();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !isActivating && styles.primaryButtonPressed,
                isActivating && styles.primaryButtonDisabled,
              ]}
            >
              {isActivating ? (
                <ActivityIndicator size="small" color={colors.primaryText} />
              ) : (
                <Text style={styles.primaryButtonText}>Activate this phone</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {loadState.kind === "ready" &&
        (request?.status === "REJECTED" || request?.status === "CANCELLED") ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeTitle, { color: t.text }]}>Need help?</Text>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              Contact support@getoneto.com if you want us to review this case with you.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/(onboarding)/device-linked")}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: t.border, backgroundColor: t.bg },
                pressed && styles.secondaryButtonPressed,
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: t.text }]}>
                Back to recovery options
              </Text>
            </Pressable>
          </View>
        ) : null}

        {loadState.kind === "ready" && request === null ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/(onboarding)/device-linked")}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: t.border, backgroundColor: t.bg },
                pressed && styles.secondaryButtonPressed,
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: t.text }]}>
                Back to recovery options
              </Text>
            </Pressable>
          </View>
        ) : null}

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </View>
    </Screen>
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
  warning: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: 20,
  },
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  noticeCard: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
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
  linkText: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonPressed: {
    opacity: 0.92,
    transform: [{ translateY: 1 }],
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: colors.primaryText,
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonPressed: {
    opacity: 0.92,
    transform: [{ translateY: 1 }],
  },
  secondaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
  },
  pinInput: {
    minHeight: 52,
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  error: {
    color: colors.error,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
});
