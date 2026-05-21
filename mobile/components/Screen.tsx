import type { ReactElement, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  View,
  ViewStyle,
} from "react-native";
import {
  SafeAreaView,
  type Edge,
} from "react-native-safe-area-context";
import { useThemeMode } from "../src/theme/theme-provider";
import { getTheme } from "../src/theme/tokens";

interface ScreenProps {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly keyboard?: boolean;
  readonly edges?: readonly Edge[];
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly style?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  scroll = false,
  keyboard = false,
  edges = ["top", "bottom"],
  contentContainerStyle,
  style,
}: ScreenProps): ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  const content = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: t.bg }, style]}
      edges={edges}
    >
      {keyboard ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}
