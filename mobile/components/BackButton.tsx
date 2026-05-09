import { Pressable, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import {
  colors,
  borders,
  radii,
  dimensions,
} from "@/theme/tokens";

interface Props {
  onPress?: () => void;
}

export function BackButton({ onPress }: Props): React.ReactElement {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={onPress ?? (() => router.back())}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={8}
    >
      <Text style={styles.arrow}>←</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: dimensions.headerBackButton.size,
    height: dimensions.headerBackButton.size,
    borderRadius: radii.md,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  arrow: {
    fontSize: 18,
    color: colors.light.text,
    includeFontPadding: false,  // removes Android's extra vertical padding
    lineHeight: 18,             // locks the line box to exactly the font size
    textAlign: "center",
  },
});