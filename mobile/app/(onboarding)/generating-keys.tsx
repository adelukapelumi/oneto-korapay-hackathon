import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { generateKeypair } from "@oneto/shared";
import {
  moveKeypairToPendingRecovery,
  saveKeypairUnderPin,
} from "../../src/crypto/pin-derive";
import {
  registerPublicKey,
  RotationSignatureRequiredError,
} from "../../src/api/keys";
import { NetworkError } from "../../src/api/errors";
import { useAuth } from "../../src/auth/auth-state";
import { logger } from "../../src/lib/logger";
import { useThemeMode } from "../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  spacing,
  radii,
  borders,
} from "../../src/theme/tokens";

type Phase =
  | { kind: "working"; message: string }
  | { kind: "error"; message: string };

const STEP_MESSAGES: [string, string, string] = [
  "Generating keys…",
  "Securing your wallet…",
  "Registering with oneto…",
];
const PROGRESS_CELLS = 8;

export default function GeneratingKeysScreen(): React.ReactElement {
  const { completeOnboarding, stagePendingRecoveryKeypair } = useAuth();
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const params = useLocalSearchParams<{ pin?: string }>();
  const pin = typeof params.pin === "string" ? params.pin : "";
  const [phase, setPhase] = useState<Phase>({
    kind: "working",
    message: "Generating keypair…",
  });
  const [progressStep, setProgressStep] = useState(0);
  const startedRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 750,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
        easing: Easing.linear,
      }),
    ).start();
  }, [pulseAnim, spinAnim]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!pin || pin.length !== 6) {
      setPhase({ kind: "error", message: "Missing PIN. Go back and try again." });
      return;
    }

    void (async () => {
      let generatedPrivateKey: Uint8Array | null = null;
      let generatedPublicKeyString: string | null = null;
      try {
        // 1. Generate keypair (Ed25519 from @oneto/shared — never roll our own)
        setPhase({ kind: "working", message: STEP_MESSAGES[0] });
        setProgressStep(0);
        // Yield to the event loop so the loading UI renders before scrypt starts.
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        const { privateKey, publicKeyString } = generateKeypair();
        generatedPrivateKey = privateKey;
        generatedPublicKeyString = publicKeyString;

        // 2. Encrypt with PIN-derived key and persist in secure-store
        setPhase({ kind: "working", message: STEP_MESSAGES[1] });
        setProgressStep(1);
        await saveKeypairUnderPin(privateKey, publicKeyString, pin);

        // 3. Register public key with backend
        setPhase({ kind: "working", message: STEP_MESSAGES[2] });
        setProgressStep(2);
        await registerPublicKey(publicKeyString);

        // 4. Hand decrypted private key to the auth provider (in-memory ref).
        completeOnboarding(privateKey, publicKeyString);
        // After this, _layout sees status=authed and redirects to /home.
      } catch (err) {
        if (err instanceof RotationSignatureRequiredError) {
          try {
            // Keep the newly generated key on-device, but move it out of the
            // active slot so auth bootstrap never mistakes it for an approved
            // payment device before recovery is reviewed.
            await moveKeypairToPendingRecovery();
            if (generatedPrivateKey && generatedPublicKeyString) {
              stagePendingRecoveryKeypair(
                generatedPrivateKey,
                generatedPublicKeyString,
              );
            }
            router.replace("/(onboarding)/device-linked");
          } catch (moveErr) {
            logger.warn("Failed to stage pending recovery keypair", moveErr);
            setPhase({
              kind: "error",
              message:
                "We couldn't prepare recovery on this phone. Try again.",
            });
          }
          return;
        }
        if (err instanceof NetworkError) {
          setPhase({
            kind: "error",
            message:
              "Couldn't reach oneto. Check your connection and try again.",
          });
          return;
        }
        logger.warn("Onboarding key registration failed", err);
        setPhase({
          kind: "error",
          message: "Something went wrong. Try again.",
        });
      }
    })();
  }, [pin, completeOnboarding, router, stagePendingRecoveryKeypair]);

  const spinInterpolation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  if (phase.kind === "error") {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
        <View style={styles.container}>
          <Text style={[styles.title, { color: t.text }]}>Setup failed</Text>
          <Text style={[styles.body, { color: t.textSec }]}>{phase.message}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => {
              startedRef.current = false;
              setPhase({ kind: "working", message: "Retrying…" });
            }}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      <View style={styles.container}>
        {/* Pulsing glow */}
        <Animated.View
          style={[styles.glow, { transform: [{ scale: pulseAnim }] }]}
        />

        {/* Spinner */}
        <Animated.View
          style={[
            styles.spinner,
            { transform: [{ rotate: spinInterpolation }] },
          ]}
        />

        {/* Status message */}
        <Text style={[styles.workingMessage, { color: t.text }]}>{phase.message}</Text>

        {/* Pixel progress bar */}
        <View style={styles.progressRow}>
          {Array.from({ length: PROGRESS_CELLS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressCell,
                { backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
                i <= progressStep * 2 + 1 && styles.progressCellActive,
              ]}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.primary,
    opacity: 0.12,
  },
  spinner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "transparent",
    borderTopColor: colors.primary,
  },
  workingMessage: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
    marginTop: spacing.sectionGap,
  },
  progressRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: spacing.xl,
  },
  progressCell: {
    width: 12,
    height: 12,
  },
  progressCellActive: {
    backgroundColor: colors.primary,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h3,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.input,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: spacing["2xl"],
  },
  button: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["3xl"],
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  buttonText: {
    fontFamily: fonts.bold,
    color: colors.primaryText,
    fontSize: fontSizes.button,
  },
});
