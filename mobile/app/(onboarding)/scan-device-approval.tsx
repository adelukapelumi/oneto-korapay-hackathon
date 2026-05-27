import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import { registerPublicKey } from "../../src/api/keys";
import { useAuth } from "../../src/auth/auth-state";
import {
  PinIncorrectError,
  PinLockedError,
  clearPendingRecoveryAttempts,
  getPendingRecoveryAttemptState,
  getPendingRecoveryPublicKey,
  loadAndDecryptPendingRecoveryKeypair,
  promotePendingRecoveryKeypair,
  recordPendingRecoveryWrongAttempt,
  wipePendingRecoveryKeypair,
} from "../../src/crypto/pin-derive";
import { describeAttemptState, formatMmSs } from "../../src/lib/pin-attempts";
import {
  APPROVAL_FAILED_RESCAN_MESSAGE,
  APPROVAL_RECOVERY_KEY_MISSING_MESSAGE,
  activateDeviceApproval,
  precheckDeviceApproval,
  type DeviceApprovalLog,
} from "../../src/keys/device-approval-activation";
import { logger } from "../../src/lib/logger";
import { useThemeMode } from "../../src/theme/theme-provider";
import {
  borders,
  colors,
  dimensions,
  fontSizes,
  fonts,
  getTheme,
  radii,
  spacing,
} from "../../src/theme/tokens";

type Phase =
  | { readonly kind: "scanning" }
  | { readonly kind: "checking" }
  | { readonly kind: "needs_pin"; readonly rawApprovalQr: string }
  | { readonly kind: "activating" }
  | { readonly kind: "error"; readonly message: string };

export default function ScanDeviceApprovalScreen(): React.ReactElement {
  const router = useRouter();
  const {
    state,
    completeOnboarding,
    discardPendingRecoveryKeypair,
    getPendingRecoveryKeypair,
  } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const [pin, setPin] = useState("");
  const [lockSecondsRemaining, setLockSecondsRemaining] = useState(0);

  useEffect(() => {
    if (permission && !permission.granted) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const state = await getPendingRecoveryAttemptState();
      if (cancelled) return;
      setLockSecondsRemaining(describeAttemptState(state).lockSecondsRemaining);
    };
    void refresh();
    const id = setInterval(() => void refresh(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function logDeviceApproval(entry: DeviceApprovalLog): void {
    logger.info(entry.event, entry.context ?? {});
  }

  async function processApproval(rawApprovalQr: string): Promise<void> {
    setPhase({ kind: "checking" });
    try {
      const staged = getPendingRecoveryKeypair();
      const pendingPublicKey = staged
        ? staged.publicKey
        : await getPendingRecoveryPublicKey();
      if (!pendingPublicKey) {
        logDeviceApproval({
          event: "recovery_key_missing",
          context: { stage: "scan" },
        });
        setPhase({
          kind: "error",
          message: APPROVAL_RECOVERY_KEY_MISSING_MESSAGE,
        });
        return;
      }

      if (!staged) {
        const precheck = precheckDeviceApproval({
          rawApprovalQr,
          pendingPublicKey,
          log: logDeviceApproval,
        });
        if (!precheck.ok) {
          setPhase({
            kind: "error",
            message: precheck.message,
          });
          return;
        }
        setPhase({ kind: "needs_pin", rawApprovalQr });
        return;
      }

      setPhase({ kind: "activating" });
      const result = await activateDeviceApproval({
        rawApprovalQr,
        pendingPublicKey: staged.publicKey,
        pendingPrivateKey: staged.privateKey,
        authStateStatus: state.status,
        registerPublicKey,
        promotePendingRecoveryKeypair,
        completeOnboarding,
        log: logDeviceApproval,
      });
      if (!result.ok) {
        setPhase({ kind: "error", message: result.message });
        return;
      }
      await clearPendingRecoveryAttempts();
      logDeviceApproval({
        event: "route_replace",
        context: { routeTarget: result.routeTarget },
      });
      router.replace(result.routeTarget);
    } catch (err) {
      logDeviceApproval({
        event: "process_approval_failed",
        context: { stage: "scan" },
      });
      setPhase({ kind: "error", message: APPROVAL_FAILED_RESCAN_MESSAGE });
    }
  }

  async function activateWithPin(rawApprovalQr: string): Promise<void> {
    if (pin.length !== 6 || phase.kind === "activating") {
      return;
    }
    setPhase({ kind: "activating" });
    let loaded:
      | { readonly privateKey: Uint8Array; readonly publicKey: string }
      | null = null;
    try {
      loaded = await loadAndDecryptPendingRecoveryKeypair(pin);
      const result = await activateDeviceApproval({
        rawApprovalQr,
        pendingPublicKey: loaded.publicKey,
        pendingPrivateKey: loaded.privateKey,
        authStateStatus: state.status,
        registerPublicKey,
        promotePendingRecoveryKeypair,
        completeOnboarding,
        log: logDeviceApproval,
      });
      if (!result.ok) {
        setPhase({ kind: "error", message: result.message });
        return;
      }
      await clearPendingRecoveryAttempts();
      logDeviceApproval({
        event: "route_replace",
        context: { routeTarget: result.routeTarget },
      });
      router.replace(result.routeTarget);
    } catch (err) {
      if (err instanceof PinLockedError) {
        const remaining = Math.max(
          0,
          Math.ceil((err.lockedUntilMs - Date.now()) / 1000),
        );
        setLockSecondsRemaining(remaining);
        setPhase({
          kind: "needs_pin",
          rawApprovalQr,
        });
        return;
      }
      if (err instanceof PinIncorrectError) {
        const result = await recordPendingRecoveryWrongAttempt();
        if (result.willWipe) {
          discardPendingRecoveryKeypair();
          await wipePendingRecoveryKeypair();
          logDeviceApproval({
            event: "recovery_key_missing",
            context: { stage: "pin_unlock_wipe" },
          });
          setPhase({
            kind: "error",
            message: APPROVAL_RECOVERY_KEY_MISSING_MESSAGE,
          });
          return;
        }
        const state = await getPendingRecoveryAttemptState();
        setLockSecondsRemaining(
          describeAttemptState(state).lockSecondsRemaining,
        );
        setPin("");
        setPhase({ kind: "needs_pin", rawApprovalQr });
        return;
      }
      logDeviceApproval({
        event: "process_approval_failed",
        context: { stage: "pin_activate" },
      });
      setPhase({ kind: "error", message: APPROVAL_FAILED_RESCAN_MESSAGE });
    } finally {
      if (loaded) {
        loaded.privateKey.fill(0);
      }
    }
  }

  function retry(): void {
    setPin("");
    setPhase({ kind: "scanning" });
  }

  if (!permission?.granted) {
    return (
      <Screen contentContainerStyle={styles.permissionContainer}>
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.title, { color: t.text }]}>Camera access required</Text>
          <Text style={[styles.body, { color: t.textSec }]}>
            Scan the approval code shown on your old phone.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={requestPermission}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Grant permission</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (phase.kind === "needs_pin") {
    return (
      <Screen scroll keyboard contentContainerStyle={styles.content}>
        <View style={styles.container}>
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={styles.eyebrow}>APPROVAL SCANNED</Text>
            <Text style={[styles.title, { color: t.text }]}>Enter this phone's PIN</Text>
            <Text style={[styles.body, { color: t.textSec }]}>
              Enter the PIN you created on this new phone so Oneto can finish setup.
            </Text>
            <TextInput
              value={pin}
              onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
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
            {lockSecondsRemaining > 0 ? (
              <Text style={styles.error}>
                Locked. Try again in {formatMmSs(lockSecondsRemaining)}.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={pin.length !== 6 || lockSecondsRemaining > 0}
              onPress={() => {
                void activateWithPin(phase.rawApprovalQr);
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                (pin.length !== 6 || lockSecondsRemaining > 0) &&
                  styles.buttonDisabled,
                pressed &&
                  pin.length === 6 &&
                  lockSecondsRemaining === 0 &&
                  styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Activate this phone</Text>
            </Pressable>
          </View>
        </View>
      </Screen>
    );
  }

  if (phase.kind === "error") {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <View style={styles.container}>
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.title, { color: t.text }]}>Approval failed</Text>
            <Text style={[styles.body, { color: t.textSec }]}>{phase.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={retry}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Scan again</Text>
            </Pressable>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={styles.camera}
        facing="back"
        onBarcodeScanned={
          phase.kind === "scanning"
            ? ({ data }: { readonly data: string }) => {
                void processApproval(data);
              }
            : undefined
        }
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      />
      <View style={styles.overlay}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={styles.backIcon}>{"<"}</Text>
          </Pressable>
        </View>
        <View style={styles.scanArea}>
          <View style={styles.scanFrame} />
        </View>
        <View style={styles.bottomSection}>
          {phase.kind === "checking" || phase.kind === "activating" ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
          <Text style={styles.scanTitle}>Scan old phone approval</Text>
          <Text style={styles.scanText}>
            Only scan the approval code shown by your own old phone.
          </Text>
          <Text style={styles.scanText}>
            Your old phone can stay on the approval screen until this phone is active.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.lg,
  },
  permissionContainer: {
    padding: spacing.xl,
    justifyContent: "center",
  },
  card: {
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
  pinInput: {
    minHeight: 52,
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular,
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
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.primaryText,
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    textAlign: "center",
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ translateY: 1 }],
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  error: {
    color: colors.error,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  headerRow: {
    minHeight: dimensions.headerMinHeight,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    justifyContent: "center",
  },
  backButton: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { fontSize: 18, color: "#fff" },
  scanArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    width: 260,
    height: 260,
    borderWidth: 4,
    borderColor: colors.secondary,
    borderRadius: radii.lg,
  },
  bottomSection: {
    paddingBottom: 80,
    alignItems: "center",
    paddingHorizontal: spacing["2xl"],
    gap: spacing.sm,
  },
  scanTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
    color: "#fff",
    textAlign: "center",
  },
  scanText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: "#fff",
    textAlign: "center",
    lineHeight: 22,
  },
});
