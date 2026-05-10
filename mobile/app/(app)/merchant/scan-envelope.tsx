import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Alert, Pressable, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { verifyEnvelopeLocally } from "../../../src/payment/verify-local";
import { insertPendingTransaction } from "../../../src/ledger/db";
import { useAuth } from "../../../src/auth/auth-state";
import type { PaymentRequest } from "@oneto/shared";
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
  const { requestJson } = useLocalSearchParams<{ requestJson: string }>();
  const router = useRouter();
  const { state } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

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
      ])
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
      ])
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
  if (!requestJson) return null;

  const originalRequest = JSON.parse(requestJson) as PaymentRequest;

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      const parsedData = JSON.parse(data);
      const verifyResult = verifyEnvelopeLocally(parsedData);

      if (!verifyResult.ok) {
        Alert.alert("Invalid Payment", "The payment could not be verified.", [
          { text: "Try Again", onPress: () => setScanned(false) }
        ]);
        return;
      }

      const envelope = verifyResult.envelope;

      if (
        envelope.requestNonce !== originalRequest.requestNonce ||
        envelope.recipientUserId !== state.user.id ||
        envelope.amountKobo !== originalRequest.amountKobo
      ) {
        Alert.alert("Invalid Payment", "This payment does not match the request.", [
          { text: "Try Again", onPress: () => setScanned(false) }
        ]);
        return;
      }

      setShowSuccess(true);

      insertPendingTransaction({
        id: envelope.transactionId,
        envelopeJson: JSON.stringify(envelope),
        recipientId: state.user.id,
        recipientLabel: undefined,
        amountKobo: envelope.amountKobo,
        sequenceNumber: envelope.senderSequenceNumber,
        direction: "incoming",
        createdAt: new Date().toISOString(),
      });

      setTimeout(() => {
        router.replace({
          pathname: "/(app)/merchant/success",
          params: { senderUserId: envelope.senderUserId, amountKobo: String(envelope.amountKobo) }
        });
      }, 400);

    } catch {
      Alert.alert("Invalid QR", "Could not parse payment data.", [
        { text: "Try Again", onPress: () => setScanned(false) }
      ]);
    }
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
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerLabel}>Scan Response</Text>
        </View>
        <View style={styles.permissionContainer}>
          <View style={styles.permissionCard}>
            <Text style={styles.permissionIcon}>📷</Text>
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionText}>
              We need camera access to scan the customer's payment QR code.
            </Text>
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
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      >
        <View style={styles.overlay}>
          <SafeAreaView edges={["top"]} style={styles.headerTransparent}>
            <View style={styles.headerRow}>
              <Pressable
                style={styles.backButtonTransparent}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Text style={styles.backIconWhite}>←</Text>
              </Pressable>
              <View style={styles.headerSpacer} />
              <Text style={styles.headerLabelWhite}>Scan Response</Text>
            </View>
          </SafeAreaView>

          <View style={styles.scanAreaWrapper}>
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
            <Text style={styles.scanText}>
              {showSuccess ? "Payment verified ✓" : "Scan the customer's response"}
            </Text>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },

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

  bottomSection: { paddingBottom: 80, alignItems: "center" },
  scanText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
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
