import { useState, useRef, useCallback } from "react";
import { StyleSheet, View, Text, Button, Alert } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter, useFocusEffect } from "expo-router";
import { PaymentRequestSchema } from "@oneto/shared";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const router = useRouter();
  
  // Guard against handling the same scan event multiple times while navigating
  const scanned = useRef(false);

  // Reset the scanned flag whenever this screen comes into focus
  // (e.g. if the user hits "Back" from the confirm screen to scan again)
  useFocusEffect(
    useCallback(() => {
      scanned.current = false;
    }, [])
  );

  if (!permission) {
    // Camera permissions are still loading
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          We need your permission to show the camera to scan merchant QR codes.
        </Text>
        <Button onPress={requestPermission} title="Grant Permission" />
      </View>
    );
  }

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned.current) return;

    try {
      const parsedJson = JSON.parse(data);
      const result = PaymentRequestSchema.safeParse(parsedJson);

      if (result.success) {
        scanned.current = true;
        // Navigate to the confirm screen, passing the validated data.
        // We use stringify because router params must be strings.
        router.push({
          pathname: "/(app)/pay/confirm",
          params: { request: JSON.stringify(result.data) },
        });
      } else {
        // We scanned a QR code, but it's not a valid Oneto payment request.
        // Alert the user and let them try again.
        scanned.current = true; // pause scanning while alert is visible
        Alert.alert(
          "Invalid QR Code",
          "This doesn't look like a valid Oneto merchant request.",
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
    } catch (e) {
      // Not a JSON string at all
      scanned.current = true;
      Alert.alert(
        "Invalid QR Code",
        "Could not read this QR code.",
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
  };

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
        <View style={styles.overlay}>
          <View style={styles.scanTarget} />
          <Text style={styles.scanText}>Scan Merchant QR Code</Text>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
    paddingHorizontal: 20,
    fontSize: 16,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanTarget: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: "#ffffff",
    backgroundColor: "transparent",
    marginBottom: 20,
  },
  scanText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
