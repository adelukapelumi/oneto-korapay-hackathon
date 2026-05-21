import { useWindowDimensions } from "react-native";
import {
  getCompactLayoutMetrics,
  type CompactLayoutMetrics,
} from "./responsive-metrics";

export { getCompactLayoutMetrics };
export type { CompactLayoutMetrics };

export function useCompactLayout(): CompactLayoutMetrics {
  const { width, height } = useWindowDimensions();
  return getCompactLayoutMetrics(width, height);
}
