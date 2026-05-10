import { Stack } from "expo-router";

export default function AppLayout(): React.ReactElement {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}