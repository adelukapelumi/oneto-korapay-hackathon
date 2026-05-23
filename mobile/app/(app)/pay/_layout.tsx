import { Stack } from "expo-router";

export default function PayLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen 
        name="scan" 
        options={{ 
          // Use standard iOS modal presentation for the whole pay flow
          presentation: "modal"
        }} 
      />
      <Stack.Screen 
        name="confirm" 
        options={{ 
          // Prevent swiping back once we're on the confirm screen (must tap back)
          gestureEnabled: false
        }} 
      />
      <Stack.Screen 
        name="display" 
        options={{ 
          // Once signed, no going back to the confirm screen
          headerBackVisible: false,
          gestureEnabled: false
        }} 
      />
    </Stack>
  );
}
