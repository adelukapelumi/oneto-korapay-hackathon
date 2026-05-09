import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/auth/auth-state";
import { useThemeMode } from "../../src/theme/theme-provider";
import { BackButton } from "../../components/BackButton";
import {
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  shadows,
  dimensions,
} from "../../src/theme/tokens";

interface SettingsRowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  showArrow?: boolean;
  isLast?: boolean;
}

function SettingsRow({
  label,
  value,
  onPress,
  showArrow,
  isLast,
}: SettingsRowProps): React.ReactElement {
  return (
    <Pressable
      style={[styles.settingsRow, !isLast && styles.settingsRowBorder]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={styles.settingsRowLabel}>{label}</Text>
      <View style={styles.settingsRowRight}>
        {value !== undefined && (
          <Text style={styles.settingsRowValue}>{value}</Text>
        )}
        {showArrow && <Text style={styles.settingsRowArrow}>→</Text>}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter();
  const { state, signOut } = useAuth();
  const { mode, toggleTheme } = useThemeMode();

  if (state.status !== "authed") {
    return <View />;
  }

  const user = state.user;
  const email = user.email || "—";
  const displayName = email.split("@")[0] || "User";
  const isStudent = user.role === "STUDENT";
  const statusDisplay = user.status === "ACTIVE" ? "✓ Active" : user.status;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>Settings</Text>
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
          <Text style={styles.profileName}>{displayName}</Text>
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
        <View style={styles.settingsCard}>
          <SettingsRow label="Email" value={email} />
          <SettingsRow
            label="Change PIN"
            showArrow
            onPress={() => router.push("/(app)/change-pin")}
          />
          {/* Theme toggle — pressing cycles between Light and Dark.
              The preference is persisted across app restarts via SecureStore. */}
          <SettingsRow
            label="Appearance"
            value={mode === "light" ? "☀️  Light" : "🌙  Dark"}
            onPress={toggleTheme}
          />
          <SettingsRow
            label="Account Status"
            value={statusDisplay}
            isLast
          />
        </View>

        {/* Account Info Card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>User ID</Text>
            <Text style={styles.infoValue}>{user.id.slice(0, 12)}...</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.infoValue}>{user.role}</Text>
          </View>
        </View>

        {/* Sign Out */}
        <Pressable
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.signOutButtonPressed,
          ]}
          onPress={() => void signOut()}
          accessibilityRole="button"
        >
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </Pressable>

        {/* Version */}
        <View style={styles.versionSection}>
          <Text style={styles.versionText}>ONETO V1.0.0 — PILOT</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.bg },

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
    color: colors.light.text,
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
    color: colors.light.text,
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
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    ...shadows.neu.light,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg,
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.light.border + "40",
  },
  settingsRowLabel: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLg,
    color: colors.light.text,
  },
  settingsRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  settingsRowValue: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
  },
  settingsRowArrow: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.body,
    color: colors.light.textMut,
  },

  infoCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.light.cardAlt,
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
    color: colors.light.textMut,
  },
  infoValue: {
    fontFamily: fonts.medium,
    fontSize: fontSizes.caption,
    color: colors.light.textSec,
  },

  signOutButton: {
    marginTop: spacing["2xl"],
    height: 52,
    backgroundColor: colors.error,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  signOutButtonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  signOutButtonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: "#fff",
  },

  versionSection: {
    alignItems: "center",
    marginTop: spacing["2xl"],
    paddingBottom: spacing.xl,
  },
  versionText: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.xs,
    color: colors.light.textMut,
  },
});
