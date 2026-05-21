import { Redirect } from "expo-router";
import { MERCHANT_SCAN_ROUTE } from "../../../src/payment/merchant-flow";

export default function RequestQRScreen(): React.ReactElement {
  // TODO: Delete this retired merchant-generated QR route after confirming no
  // navigation paths or deep links still rely on it.
  return <Redirect href={MERCHANT_SCAN_ROUTE} />;
}
