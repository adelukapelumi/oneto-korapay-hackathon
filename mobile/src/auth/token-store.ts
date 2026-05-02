import * as SecureStore from "expo-secure-store";

// expo-secure-store keys must be alphanumeric, dots, dashes, underscores.
// This key is namespaced so future stored items (e.g., a device key, refresh
// token) don't collide.
const JWT_KEY = "oneto.jwt";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(JWT_KEY);
}

export async function setToken(jwt: string): Promise<void> {
  await SecureStore.setItemAsync(JWT_KEY, jwt);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(JWT_KEY);
}
