import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { Screen } from "../../components/Screen";
import { useAuth } from "../../src/auth/auth-state";
import { getToken } from "../../src/auth/token-store";
import { getPendingRecoveryPublicKey } from "../../src/crypto/pin-derive";
import {
  buildNewDeviceRequestPayload,
  stringifyDeviceTransferPayload,
} from "../../src/keys/device-transfer-payload";
import { logger } from "../../src/lib/logger";
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
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly publicKey: string }
  | { readonly kind: "error"; readonly message: string };

export default function MoveDeviceScreen(): React.ReactElement {
  const router = useRouter();
  const { state, getPendingRecoveryKeypair } = useAuth();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    void (async () => {
      const token = await getToken();
      logger.info("recovery_screen_auth_context", {
        screen: "move-device",
        authStateStatus: state.status,
        tokenPresent: Boolean(token),
      });
    })();
  }, [state.status]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const staged = getPendingRecoveryKeypair();
        const publicKey = staged
          ? staged.publicKey
          : await getPendingRecoveryPublicKey();
        if (cancelled) return;
        if (!publicKey) {
          setLoadState({
            kind: "error",
            message:
              "This phone does not have a pending setup key. Start setup again.",
          });
          return;
        }
        buildNewDeviceRequestPayload(publicKey);
        setLoadState({ kind: "ready", publicKey });
      } catch {
        if (cancelled) return;
        setLoadState({
          kind: "error",
          message:
            "This phone could not prepare a move request. Start setup again.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getPendingRecoveryKeypair]);

  const qrValue = useMemo(() => {
    if (loadState.kind !== "ready") return null;
    return stringifyDeviceTransferPayload(
      buildNewDeviceRequestPayload(loadState.publicKey),
    );
  }, [loadState]);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <View style={styles.container}>
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={styles.eyebrow}>MOVE PHONE</Text>
          <Text style={[styles.title, { color: t.text }]}>
            Approve from your old phone
          </Text>
          <Text style={[styles.body, { color: t.textSec }]}>
            {`Open Oneto on your old phone, go to Settings -> Move Oneto to a new phone, then scan this code.`}
          </Text>
          <Text style={[styles.body, { color: t.textSec }]}>
            Your old phone will approve this new phone. Already scanned payments can still finish.
          </Text>
        </View>

        {loadState.kind === "loading" ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.inlineText, { color: t.textSec }]}>
              Preparing approval code...
            </Text>
          </View>
        ) : null}

        {loadState.kind === "ready" && qrValue ? (
          <View style={[styles.qrCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.qrInner}>
              <QRCode
                value={qrValue}
                size={240}
                ecl="M"
                quietZone={8}
                color={colors.primaryText}
                backgroundColor="#FFFFFF"
              />
            </View>
          </View>
        ) : null}

        {loadState.kind === "error" ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              {loadState.message}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={loadState.kind !== "ready"}
            onPress={() => router.push("/(onboarding)/scan-device-approval")}
            style={({ pressed }) => [
              styles.primaryButton,
              loadState.kind !== "ready" && styles.buttonDisabled,
              pressed && loadState.kind === "ready" && styles.buttonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              Scan approval from old phone
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/(onboarding)/recovery-request",
                params: { riskType: "LOST_DEVICE" },
              })
            }
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: t.cardAlt, borderColor: t.border },
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.secondaryButtonText, { color: t.text }]}>
              I lost my old phone
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.warning, { color: t.textMut }]}>
          Do not uninstall Oneto or clear app data while moving phones.
        </Text>
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
    flex: 1,
    gap: spacing.lg,
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
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  inlineText: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
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
  noticeCard: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  noticeBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 22,
  },
  actions: {
    gap: spacing.md,
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
  warning: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
    lineHeight: 20,
    textAlign: "center",
  },
});
