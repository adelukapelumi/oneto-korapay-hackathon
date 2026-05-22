import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { verifyEnvelopeLocally } from "../../../src/payment/verify-local";
import { insertPendingTransaction } from "../../../src/ledger/db";
import { useAuth } from "../../../src/auth/auth-state";
import {
  assertIncomingWithinRegulatoryHeadroom,
  MerchantBalanceCapExceededError,
  parseVerifiedBalanceKoboOrThrow,
} from "../../../src/payment/incoming-headroom";
import { logger } from "../../../src/lib/logger";
import {
  MERCHANT_SCAN_INSTRUCTION,
  MERCHANT_SCAN_TITLE,
} from "../../../src/payment/merchant-flow";
import {
  buildRecipientMismatchDebugMessage,
  MERCHANT_SCAN_CAMERA_ERROR_STATUS,
  isDuplicatePendingTransactionError,
  MERCHANT_SCAN_BALANCE_FAILED_STATUS,
  MERCHANT_SCAN_DETECTED_STATUS,
  MERCHANT_SCAN_DUPLICATE_STATUS,
  MERCHANT_SCAN_HEADROOM_EXCEEDED_STATUS,
  MERCHANT_SCAN_IDLE_STATUS,
  MERCHANT_SCAN_INVALID_PAYMENT_STATUS,
  MERCHANT_SCAN_SAVING_STATUS,
  MERCHANT_SCAN_SAVE_FAILED_STATUS,
  MERCHANT_SCAN_SUCCESS_STATUS,
  MERCHANT_SCAN_WRONG_MERCHANT_STATUS,
  parseScannedEnvelopePayload,
  type MerchantScanStatus,
} from "../../../src/payment/merchant-scan";
import {
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
  dimensions,
} from "../../../src/theme/tokens";

declare const __DEV__: boolean;

const SCAN_FRAME_SIZE = 260;
const CORNER_SIZE = 40;
const CORNER_THICKNESS = 4;

function ScanCorner({
  position,
}: {
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}): React.ReactElement {
  const isTop = position.includes("top");
  const isLeft = position.includes("left");

  return (
    <View
      style={[
        styles.corner,
        {
          top: isTop ? -2 : undefined,
          bottom: !isTop ? -2 : undefined,
          left: isLeft ? -2 : undefined,
          right: !isLeft ? -2 : undefined,
          borderTopWidth: isTop ? CORNER_THICKNESS : 0,
          borderBottomWidth: !isTop ? CORNER_THICKNESS : 0,
          borderLeftWidth: isLeft ? CORNER_THICKNESS : 0,
          borderRightWidth: !isLeft ? CORNER_THICKNESS : 0,
        },
      ]}
    />
  );
}

export default function ScanEnvelopeScreen() {
  const router = useRouter();
  const { state } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [status, setStatus] = useState<MerchantScanStatus>(MERCHANT_SCAN_IDLE_STATUS);
  const [debugMessage, setDebugMessage] = useState<string | null>(null);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [scanLineAnim]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  useEffect(() => {
    if (permission && !permission.granted) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (state.status !== "authed") return null;

  function setDevDebug(message: string): void {
    logger.debug(message);
    if (__DEV__) {
      setDebugMessage(message);
    }
  }

  function resetScanner(): void {
    setScanned(false);
    setShowSuccess(false);
    setStatus(MERCHANT_SCAN_IDLE_STATUS);
    setDebugMessage(null);
  }

  const handleBarCodeScanned = ({
    data,
    type,
  }: {
    data: string;
    type?: string;
  }) => {
    if (scanned) return;

    logger.info("Merchant scan callback fired", {
      barcodeType: type ?? "unknown",
      payloadLength: data.length,
    });

    setScanned(true);
    setStatus(MERCHANT_SCAN_DETECTED_STATUS);
    setDevDebug(`scan fired: type=${type ?? "unknown"}, payloadLength=${data.length}`);

    const parseResult = parseScannedEnvelopePayload(data);
    if (!parseResult.ok) {
      logger.warn("Merchant scan payload parse failed");
      setStatus(parseResult.status);
      setDevDebug(parseResult.debugMessage);
      return;
    }

    logger.debug("Merchant scan payload parsed successfully");
    setDevDebug("scan payload parsed successfully");

    const verifyResult = verifyEnvelopeLocally(parseResult.parsed);
    if (!verifyResult.ok) {
      logger.warn("Merchant local verify failed", { reason: verifyResult.reason });
      setStatus(MERCHANT_SCAN_INVALID_PAYMENT_STATUS);
      setDevDebug(`local verify failed: ${verifyResult.reason}`);
      return;
    }

    const envelope = verifyResult.envelope;
    logger.info("Merchant local verify succeeded", {
      transactionId: envelope.transactionId,
      senderUserId: envelope.senderUserId,
      recipientUserId: envelope.recipientUserId,
    });
    setDevDebug(`local verify ok: tx=${envelope.transactionId}`);

    if (envelope.recipientUserId !== state.user.id) {
      logger.warn("Merchant scan recipient mismatch", {
        expectedRecipientUserId: state.user.id,
        envelopeRecipientUserId: envelope.recipientUserId,
        transactionId: envelope.transactionId,
      });
      setStatus(MERCHANT_SCAN_WRONG_MERCHANT_STATUS);
      setDevDebug(
        buildRecipientMismatchDebugMessage(
          state.user.id,
          envelope.recipientUserId,
        ),
      );
      return;
    }

    try {
      const verifiedBalanceKobo = parseVerifiedBalanceKoboOrThrow(
        state.user.verifiedBalanceKobo,
      );
      assertIncomingWithinRegulatoryHeadroom(
        verifiedBalanceKobo,
        envelope.amountKobo,
      );
    } catch (error) {
      if (error instanceof MerchantBalanceCapExceededError) {
        logger.warn("Merchant scan blocked by balance cap", {
          transactionId: envelope.transactionId,
          projectedBalanceKobo: error.projectedBalanceKobo,
        });
        setStatus(MERCHANT_SCAN_HEADROOM_EXCEEDED_STATUS);
        setDevDebug(
          `headroom exceeded: projectedBalanceKobo=${error.projectedBalanceKobo}`,
        );
        return;
      }

      logger.error("Merchant scan balance headroom check failed", error);
      setStatus(MERCHANT_SCAN_BALANCE_FAILED_STATUS);
      setDevDebug("balance headroom check failed");
      return;
    }

    setStatus(MERCHANT_SCAN_SAVING_STATUS);
    setDevDebug(`saving tx=${envelope.transactionId}`);

    try {
      insertPendingTransaction({
        id: envelope.transactionId,
        envelopeJson: JSON.stringify(envelope),
        recipientId: state.user.id,
        recipientLabel: undefined,
        amountKobo: envelope.amountKobo,
        sequenceNumber: envelope.senderSequenceNumber,
        direction: "incoming",
        createdAt: envelope.timestamp,
      });
    } catch (error) {
      if (isDuplicatePendingTransactionError(error)) {
        logger.warn("Merchant scan duplicate transaction", {
          transactionId: envelope.transactionId,
        });
        setStatus(MERCHANT_SCAN_DUPLICATE_STATUS);
        setDevDebug(`duplicate scan: tx=${envelope.transactionId}`);
        return;
      }

      logger.error("Merchant scan save failed", error);
      setStatus(MERCHANT_SCAN_SAVE_FAILED_STATUS);
      setDevDebug(`save failed: tx=${envelope.transactionId}`);
      return;
    }

    setShowSuccess(true);
    setStatus(MERCHANT_SCAN_SUCCESS_STATUS);
    setDevDebug(`save success: tx=${envelope.transactionId}`);

    setTimeout(() => {
      router.replace({
        pathname: "/(app)/merchant/success",
        params: {
          senderUserId: envelope.senderUserId,
          amountKobo: String(envelope.amountKobo),
        },
      });
    }, 400);
  };

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, SCAN_FRAME_SIZE - 20],
  });

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backIcon}>{"<"}</Text>
          </Pressable>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerLabel}>{MERCHANT_SCAN_TITLE}</Text>
        </View>
        <View style={styles.permissionContainer}>
          <View style={styles.permissionCard}>
            <Text style={styles.permissionIcon}>CAM</Text>
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionText}>{MERCHANT_SCAN_INSTRUCTION}</Text>
            <Pressable
              style={({ pressed }) => [
                styles.permissionButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={requestPermission}
            >
              <Text style={styles.permissionButtonText}>Grant Permission</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={styles.camera}
        facing="back"
        onCameraReady={() => {
          logger.info("Merchant camera ready");
          setDevDebug("camera ready");
        }}
        onMountError={(event) => {
          logger.error("Merchant camera mount error", event);
          setScanned(true);
          setShowSuccess(false);
          setStatus(MERCHANT_SCAN_CAMERA_ERROR_STATUS);
          setDevDebug(`camera mount error: ${event.message}`);
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <SafeAreaView edges={["top"]} style={styles.headerTransparent}>
          <View style={styles.headerRow}>
            <Pressable
              style={styles.backButtonTransparent}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Text style={styles.backIconWhite}>{"<"}</Text>
            </Pressable>
            <View style={styles.headerSpacer} />
            <Text style={styles.headerLabelWhite}>{MERCHANT_SCAN_TITLE}</Text>
          </View>
        </SafeAreaView>

        <View style={styles.scanAreaWrapper} pointerEvents="none">
          <Animated.View style={[styles.scanFrame, { opacity: pulseAnim }]}>
            <ScanCorner position="top-left" />
            <ScanCorner position="top-right" />
            <ScanCorner position="bottom-left" />
            <ScanCorner position="bottom-right" />

            {!showSuccess && (
              <Animated.View
                style={[
                  styles.scanLine,
                  { transform: [{ translateY: scanLineTranslate }] },
                ]}
              />
            )}

            {showSuccess && <View style={styles.successFlash} />}
          </Animated.View>
        </View>

        <View style={styles.bottomSection}>
          <Text style={styles.scanTitle}>{status.title}</Text>
          <Text style={styles.scanText}>{status.message}</Text>

          {__DEV__ && debugMessage ? (
            <Text style={styles.debugText}>{debugMessage}</Text>
          ) : null}

          {scanned && !showSuccess ? (
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={resetScanner}
              accessibilityRole="button"
              accessibilityLabel="Scan another payment QR"
            >
              <Text style={styles.retryButtonText}>Scan Again</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1, backgroundColor: "#000", position: "relative" },
  safe: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },

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
    borderColor: colors.dark.border,
    backgroundColor: colors.dark.card,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { fontSize: 18, color: colors.dark.text },
  headerSpacer: { flex: 1 },
  headerLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.dark.textSec,
  },

  headerTransparent: { backgroundColor: "transparent" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  backButtonTransparent: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  backIconWhite: { fontSize: 18, color: "#fff" },
  headerLabelWhite: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: "#fff",
  },

  scanAreaWrapper: { flex: 1, alignItems: "center", justifyContent: "center" },
  scanFrame: { width: SCAN_FRAME_SIZE, height: SCAN_FRAME_SIZE, position: "relative" },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.secondary,
  },
  scanLine: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: colors.secondary,
    shadowColor: colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  successFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.primary + "30",
    borderRadius: radii.sm,
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
  debugText: {
    marginTop: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    color: "#D1FAE5",
    textAlign: "center",
  },
  retryButton: {
    marginTop: spacing.lg,
    minWidth: 180,
    height: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: "#fff",
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: "#fff",
  },

  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  permissionCard: {
    backgroundColor: colors.dark.card,
    borderWidth: borders.standard,
    borderColor: colors.dark.border,
    borderRadius: radii.xl,
    padding: spacing["2xl"],
    alignItems: "center",
    width: "100%",
  },
  permissionIcon: { fontSize: 48, marginBottom: spacing.lg },
  permissionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    color: colors.dark.text,
    marginBottom: spacing.sm,
  },
  permissionText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.dark.textSec,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing["2xl"],
  },
  permissionButton: {
    width: "100%",
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.dark.border,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
  buttonPressed: { transform: [{ translateX: 2 }, { translateY: 2 }] },
});
