import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth/auth-state";
import { useThemeMode } from "../../src/theme/theme-provider";
import { BackButton } from "../../components/BackButton";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  dimensions,
} from "../../src/theme/tokens";

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  showArrow?: boolean;
  isLast?: boolean;
  theme: ReturnType<typeof getTheme>;
}

function SettingsRow({
  label,
  value,
  onPress,
  showArrow,
  isLast,
  theme,
}: SettingsRowProps): React.ReactElement {
  return (
    <Pressable
      style={[styles.settingsRow, !isLast && [styles.settingsRowBorder, { borderBottomColor: theme.border + "40" }]]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={[styles.settingsRowLabel, { color: theme.text }]}>{label}</Text>
      <View style={styles.settingsRowRight}>
        {value !== undefined && (
          <Text style={[styles.settingsRowValue, { color: theme.textSec }]}>{value}</Text>
        )}
        {showArrow && <Text style={[styles.settingsRowArrow, { color: theme.textMut }]}>→</Text>}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter();
  const {
    state,
    wipeLocalPaymentKeyOnlyForTesting,
    resetLocalAppForTesting,
  } = useAuth();
  const { mode, toggleTheme } = useThemeMode();
  const [isWipingPaymentKey, setIsWipingPaymentKey] = useState(false);
  const [isResettingLocalApp, setIsResettingLocalApp] = useState(false);
  const t = getTheme(mode);

  if (state.status !== "authed") {
    return <View />;
  }

  const user = state.user;
  const email = user.email || "—";
  const displayName = email.split("@")[0] || "User";
  const isStudent = user.role === "STUDENT";
  const statusDisplay = user.status === "ACTIVE" ? "✓ Active" : user.status;

  async function performPaymentKeyWipe(): Promise<void> {
    if (isWipingPaymentKey || isResettingLocalApp) {
      return;
    }

    setIsWipingPaymentKey(true);
    try {
      await wipeLocalPaymentKeyOnlyForTesting();
      Alert.alert(
        "Payment key wiped",
        "This phone's local payment key was wiped. The account is still linked on the server, so setup may require recovery.",
      );
      router.replace("/");
    } catch {
      Alert.alert(
        "Wipe failed",
        "Couldn't wipe this phone's payment key. Close and reopen the app, then try again.",
      );
    } finally {
      setIsWipingPaymentKey(false);
    }
  }

  function confirmPaymentKeyWipe(): void {
    if (isWipingPaymentKey || isResettingLocalApp) {
      return;
    }

    Alert.alert(
      "TEST ONLY",
      "This simulates losing this phone's payment key. It does not unlink the account on the server. Signing in or setting up again may require recovery.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Wipe payment key",
          style: "destructive",
          onPress: () => {
            void performPaymentKeyWipe();
          },
        },
      ],
    );
  }

  async function performFullLocalReset(): Promise<void> {
    if (isWipingPaymentKey || isResettingLocalApp) {
      return;
    }

    setIsResettingLocalApp(true);
    try {
      await resetLocalAppForTesting();
      Alert.alert(
        "Local app reset",
        "This device was reset locally. Server account links, balances, and ledger rows were not changed.",
      );
      router.replace("/");
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
    if (isWipingPaymentKey || isResettingLocalApp) {
      return;
    }

    Alert.alert(
      "TESTING ONLY: reset this app",
      "This clears the token, local keys, pending recovery key, PIN attempt state, cached profile, local ledger, and merchant cache on this phone only. It does not call the backend.",
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: t.text }]}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>👤</Text>
          </View>
          <Text style={[styles.profileName, { color: t.text }]}>{displayName}</Text>
          <View style={[styles.roleBadge, !isStudent && styles.merchantBadge]}>
            <Text
              style={[
                styles.roleBadgeText,
                !isStudent && styles.merchantBadgeText,
              ]}
            >
              {user.role}
            </Text>
          </View>
        </View>

        {/* Settings Card */}
        <View style={[styles.settingsCard, { backgroundColor: t.card, borderColor: t.border }, t.shadow]}>
          <SettingsRow label="Email" value={email} theme={t} />
          <SettingsRow
            label="Change PIN"
            showArrow
            onPress={() => router.push("/(app)/change-pin")}
            theme={t}
          />
          {/* Theme toggle — pressing cycles between Light and Dark.
              The preference is persisted across app restarts via SecureStore. */}
          <SettingsRow
            label="Appearance"
            value={mode === "light" ? "☀️  Light" : "🌙  Dark"}
            onPress={toggleTheme}
            theme={t}
          />
          <SettingsRow
            label="Move Oneto to a new phone"
            showArrow
            onPress={() => router.push("/(app)/approve-new-phone")}
            theme={t}
          />
          <SettingsRow
            label="Account Status"
            value={statusDisplay}
            isLast
            theme={t}
          />
        </View>

        {/* Account Info Card */}
        <View style={[styles.infoCard, { backgroundColor: t.cardAlt }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: t.textMut }]}>User ID</Text>
            <Text style={[styles.infoValue, { color: t.textSec }]}>{user.id.slice(0, 12)}...</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: t.textMut }]}>Role</Text>
            <Text style={[styles.infoValue, { color: t.textSec }]}>{user.role}</Text>
          </View>
        </View>

        {/* TODO(TESTING_ONLY_REMOVE_BEFORE_USERS): Remove local reset buttons before production users. */}
        <Pressable
          style={({ pressed }) => [
            styles.testingResetCard,
            { borderColor: colors.error },
            t.shadow,
            pressed && !isWipingPaymentKey && !isResettingLocalApp && styles.testingResetCardPressed,
            (isWipingPaymentKey || isResettingLocalApp) && styles.testingResetCardDisabled,
          ]}
          onPress={confirmPaymentKeyWipe}
          disabled={isWipingPaymentKey || isResettingLocalApp}
          accessibilityRole="button"
        >
          <Text style={styles.testingResetEyebrow}>TESTING ONLY</Text>
          <Text style={styles.testingResetTitle}>
            Wipe payment key only
          </Text>
          <Text style={styles.testingResetBody}>
            Simulates losing this phone's payment key. It does not unlink the
            account on the server, and signing in again may require recovery.
          </Text>
          {isWipingPaymentKey ? (
            <Text style={styles.testingResetAction}>Wiping payment key...</Text>
          ) : (
            <Text style={styles.testingResetAction}>Tap to wipe only the local key</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.testingResetCard,
            { borderColor: colors.error },
            t.shadow,
            pressed && !isWipingPaymentKey && !isResettingLocalApp && styles.testingResetCardPressed,
            (isWipingPaymentKey || isResettingLocalApp) && styles.testingResetCardDisabled,
          ]}
          onPress={confirmFullLocalReset}
          disabled={isWipingPaymentKey || isResettingLocalApp}
          accessibilityRole="button"
        >
          <Text style={styles.testingResetEyebrow}>TESTING ONLY</Text>
          <Text style={styles.testingResetTitle}>
            Testing only: reset this app
          </Text>
          <Text style={styles.testingResetBody}>
            Clears this phone's token, local keys, PIN attempts, cached profile,
            pending ledger, and merchant cache. Backend records stay unchanged.
          </Text>
          {isResettingLocalApp ? (
            <Text style={styles.testingResetAction}>Resetting this app...</Text>
          ) : (
            <Text style={styles.testingResetAction}>Tap to clear local device state</Text>
          )}
        </Pressable>

        {/* Version */}
        <View style={styles.versionSection}>
          <Text style={[styles.versionText, { color: t.textMut }]}>ONETO V1.0.0 — PILOT</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: dimensions.headerMinHeight,
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: fontSizes.headerTitle,
  },
  headerSpacer: { width: dimensions.headerBackButton.size },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.screenHorizontal,
    paddingBottom: spacing["3xl"],
  },

  profileSection: { alignItems: "center", paddingVertical: spacing.xl },
  avatar: {
    width: dimensions.settingsAvatar.size,
    height: dimensions.settingsAvatar.size,
    borderRadius: dimensions.settingsAvatar.size / 2,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: colors.primary + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 28 },
  profileName: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.cardTitle,
    marginTop: spacing.md,
  },
  roleBadge: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary + "15",
    borderWidth: borders.thin,
    borderColor: colors.primary + "30",
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  merchantBadge: {
    backgroundColor: colors.secondary + "20",
    borderColor: colors.secondary + "40",
  },
  roleBadgeText: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.primary,
  },
  merchantBadgeText: { color: colors.secondary },

  settingsCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg,
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
  },
  settingsRowLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLg,
  },
  settingsRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  settingsRowValue: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  settingsRowArrow: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
  },

  infoCard: {
    marginTop: spacing.lg,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  infoLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
  },
  infoValue: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
  },

  testingResetCard: {
    marginTop: spacing["2xl"],
    backgroundColor: colors.error + "14",
    borderRadius: radii.xl,
    borderWidth: borders.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  testingResetCardPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  testingResetCardDisabled: {
    opacity: 0.7,
  },
  testingResetEyebrow: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.xs,
    color: colors.error,
  },
  testingResetTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.error,
  },
  testingResetBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.error,
    lineHeight: 22,
  },
  testingResetAction: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.error,
  },

  versionSection: {
    alignItems: "center",
    marginTop: spacing["2xl"],
    paddingBottom: spacing.xl,
  },
  versionText: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.xs,
  },
});
