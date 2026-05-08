import { useState, useRef, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { PaymentRequestSchema } from "@oneto/shared";
import {
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

export default function ScanScreen(): React.ReactElement {
  const [permission, requestPermission] = useCameraPermissions();
  const router = useRouter();
  const scanned = useRef(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Scan line animation
  const scanLineAnim = useRef(new Animated.Value(0)).current;

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

  // Corner pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

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

  useFocusEffect(
    useCallback(() => {
      scanned.current = false;
      setShowSuccess(false);
    }, [])
  );

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.permissionContainer}>
          <Text style={styles.loadingText}>Loading camera...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
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
          <View style={styles.headerSpacer} />
          <Text style={styles.headerLabel}>QR Scanner</Text>
        </View>

        <View style={styles.permissionContainer}>
          <View style={styles.permissionCard}>
            <Text style={styles.permissionIcon}>📷</Text>
            <Text style={styles.permissionTitle}>Camera Access Required</Text>
            <Text style={styles.permissionText}>
              We need camera access to scan merchant QR codes for payments.
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

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned.current) return;

    try {
      const parsedJson = JSON.parse(data);
      const result = PaymentRequestSchema.safeParse(parsedJson);

      if (result.success) {
        scanned.current = true;
        setShowSuccess(true);

        // Brief delay to show success state
        setTimeout(() => {
          router.push({
            pathname: "/(app)/pay/confirm",
            params: { request: JSON.stringify(result.data) },
          });
        }, 400);
      } else {
        scanned.current = true;
        Alert.alert(
          "Invalid QR Code",
          "This doesn't look like a valid oneto merchant request.",
          [
            {
              text: "Try Again",
              onPress: () => {
                scanned.current = false;
              },
            },
          ]
        );
      }
    } catch {
      scanned.current = true;
      Alert.alert("Invalid QR Code", "Could not read this QR code.", [
        {
          text: "Try Again",
          onPress: () => {
            scanned.current = false;
          },
        },
      ]);
    }
  };

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, SCAN_FRAME_SIZE - 20],
  });

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={handleBarcodeScanned}
      >
        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Header - transparent */}
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
              <Text style={styles.headerLabelWhite}>QR Scanner</Text>
            </View>
          </SafeAreaView>

          {/* Center scan area */}
          <View style={styles.scanAreaWrapper}>
            <Animated.View style={[styles.scanFrame, { opacity: pulseAnim }]}>
              {/* Corners */}
              <ScanCorner position="top-left" />
              <ScanCorner position="top-right" />
              <ScanCorner position="bottom-left" />
              <ScanCorner position="bottom-right" />

              {/* Scan line */}
              {!showSuccess && (
                <Animated.View
                  style={[
                    styles.scanLine,
                    { transform: [{ translateY: scanLineTranslate }] },
                  ]}
                />
              )}

              {/* Success flash */}
              {showSuccess && <View style={styles.successFlash} />}
            </Animated.View>
          </View>

          {/* Bottom text */}
          <View style={styles.bottomSection}>
            <Text style={styles.scanText}>
              {showSuccess ? "QR detected ✓" : "Scan the merchant's QR code"}
            </Text>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  safe: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },

  // Header - solid bg
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
  backIcon: {
    fontSize: 18,
    color: colors.dark.text,
  },
  headerSpacer: {
    flex: 1,
  },
  headerLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.dark.textSec,
  },

  // Header - transparent (over camera)
  headerTransparent: {
    backgroundColor: "transparent",
  },
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
  backIconWhite: {
    fontSize: 18,
    color: "#fff",
  },
  headerLabelWhite: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: "#fff",
  },

  // Scan area
  scanAreaWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.primary,
  },
  scanLine: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
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

  // Bottom section
  bottomSection: {
    paddingBottom: 80,
    alignItems: "center",
  },
  scanText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: "#fff",
  },

  // Permission screen
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.screenHorizontal,
  },
  loadingText: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.body,
    color: colors.dark.textSec,
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
  permissionIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
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
  buttonPressed: {
    transform: [{ translateX: 2 }, { translateY: 2 }],
  },
});
