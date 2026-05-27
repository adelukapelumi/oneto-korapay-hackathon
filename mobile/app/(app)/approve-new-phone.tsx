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
import QRCode from "react-native-qrcode-svg";
import { Screen } from "../../components/Screen";
import { signRotation } from "../../src/api/keys";
import { useAuth } from "../../src/auth/auth-state";
import {
  PinIncorrectError,
  PinLockedError,
  clearAttempts,
  getAttemptState,
  getStoredPublicKey,
  recordWrongAttempt,
  unlockKeypairWithPin,
  wipeKeypair,
} from "../../src/crypto/pin-derive";
import { describeAttemptState, formatMmSs } from "../../src/lib/pin-attempts";
import {
  DeviceTransferPayloadError,
  buildApprovalQrAfterPinUnlock,
  parseNewDeviceRequestQr,
  stringifyDeviceTransferPayload,
  type NewDeviceRequestPayload,
} from "../../src/keys/device-transfer-payload";
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
  | {
      readonly kind: "confirm";
      readonly rawRequestQr: string;
      readonly request: NewDeviceRequestPayload;
    }
  | { readonly kind: "signing" }
  | { readonly kind: "approval_ready"; readonly approvalQr: string }
  | { readonly kind: "error"; readonly message: string };

export default function ApproveNewPhoneScreen(): React.ReactElement {
  const router = useRouter();
  const { signOut } = useAuth();
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
      const state = await getAttemptState();
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

  function logApprovalEvent(
    event: string,
    context: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    logger.info(event, context);
  }

  function processRequest(rawRequestQr: string): void {
    try {
      const request = parseNewDeviceRequestQr(rawRequestQr);
      logApprovalEvent("old_phone_request_qr_parsed", {
        requestPublicKeySuffix: shortKeySuffix(request.newPublicKey),
      });
      setPhase({ kind: "confirm", rawRequestQr, request });
    } catch (err) {
      setPhase({ kind: "error", message: approvalErrorMessage(err) });
    }
  }

  async function approve(rawRequestQr: string): Promise<void> {
    if (pin.length !== 6 || lockSecondsRemaining > 0) {
      return;
    }
    setPhase({ kind: "signing" });
    try {
      const oldPublicKey = await getStoredPublicKey();
      const request = parseNewDeviceRequestQr(rawRequestQr);
      logApprovalEvent("old_phone_approval_signing_context", {
        oldPhonePublicKeySuffix: shortKeySuffix(oldPublicKey),
        requestPublicKeySuffix: shortKeySuffix(request.newPublicKey),
      });
      const approval = await buildApprovalQrAfterPinUnlock({
        rawRequestQr,
        pin,
        unlockKeypairWithPin,
        signRotation,
      });
      logApprovalEvent("old_phone_approval_payload_created", {
        approvalPublicKeySuffix: shortKeySuffix(approval.newPublicKey),
      });
      await clearAttempts();
      setPin("");
      setPhase({
        kind: "approval_ready",
        approvalQr: stringifyDeviceTransferPayload(approval),
      });
    } catch (err) {
      if (err instanceof PinLockedError) {
        const remaining = Math.max(
          0,
          Math.ceil((err.lockedUntilMs - Date.now()) / 1000),
        );
        setLockSecondsRemaining(remaining);
        setPhase({
          kind: "error",
          message: `Locked. Try again in ${formatMmSs(remaining)}.`,
        });
        return;
      }
      if (err instanceof PinIncorrectError) {
        const result = await recordWrongAttempt();
        if (result.willWipe) {
          await wipeKeypair();
          await signOut();
          return;
        }
        const state = await getAttemptState();
        setLockSecondsRemaining(
          describeAttemptState(state).lockSecondsRemaining,
        );
        setPin("");
        const request = parseNewDeviceRequestQr(rawRequestQr);
        setPhase({ kind: "confirm", rawRequestQr, request });
        return;
      }
      setPhase({ kind: "error", message: approvalErrorMessage(err) });
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
            Scan the code shown on your new phone.
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

  if (phase.kind === "confirm") {
    return (
      <Screen scroll keyboard contentContainerStyle={styles.content}>
        <View style={styles.container}>
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={styles.eyebrow}>MOVE ONETO</Text>
            <Text style={[styles.title, { color: t.text }]}>Approve new phone?</Text>
            <Text style={[styles.body, { color: t.textSec }]}>
              Only approve if this is your new phone.
            </Text>
            <Text style={[styles.body, { color: t.textSec }]}>
              After approval, your new phone can become active. This phone may stop making new payments after the move.
            </Text>
            <Text style={[styles.smallText, { color: t.textMut }]}>
              New phone key: {phase.request.newPublicKey.slice(0, 18)}...
            </Text>
            <TextInput
              value={pin}
              onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="Enter your Oneto PIN to approve"
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
                void approve(phase.rawRequestQr);
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
              <Text style={styles.primaryButtonText}>Approve new phone</Text>
            </Pressable>
          </View>
        </View>
      </Screen>
    );
  }

  if (phase.kind === "signing") {
    return (
      <Screen contentContainerStyle={styles.permissionContainer}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.body, { color: t.textSec }]}>Approving new phone...</Text>
      </Screen>
    );
  }

  if (phase.kind === "approval_ready") {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <View style={styles.container}>
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={styles.eyebrow}>APPROVAL READY</Text>
            <Text style={[styles.title, { color: t.text }]}>Show this to your new phone</Text>
            <Text style={[styles.body, { color: t.textSec }]}>
              Your new phone will scan this code and finish setup after Oneto accepts the approval.
            </Text>
          </View>
          <View style={[styles.qrCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.qrInner}>
              <QRCode
                value={phase.approvalQr}
                size={240}
                ecl="M"
                quietZone={8}
                color={colors.primaryText}
                backgroundColor="#FFFFFF"
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/(app)/settings")}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: t.cardAlt, borderColor: t.border },
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.secondaryButtonText, { color: t.text }]}>Done</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (phase.kind === "error") {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <View style={styles.container}>
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.title, { color: t.text }]}>Could not approve</Text>
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
        onBarcodeScanned={({ data }: { readonly data: string }) => {
          processRequest(data);
        }}
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
          <Text style={styles.scanTitle}>Move Oneto to a new phone</Text>
          <Text style={styles.scanText}>
            Scan the code shown on your new phone.
          </Text>
        </View>
      </View>
    </View>
  );
}

function approvalErrorMessage(err: unknown): string {
  if (err instanceof DeviceTransferPayloadError) {
    return err.message;
  }
  return "This is not a valid Oneto phone move request.";
}

function shortKeySuffix(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (value.length <= 8) {
    return value;
  }
  return value.slice(-8);
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
  permissionContainer: {
    padding: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
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
  smallText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: 20,
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
  secondaryButton: {
    minHeight: 52,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
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
  qrCard: {
    alignSelf: "center",
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  qrInner: {
    borderRadius: radii.sm,
    overflow: "hidden",
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
