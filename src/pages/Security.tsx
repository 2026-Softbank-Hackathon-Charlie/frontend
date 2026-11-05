import { useSecurity } from "../api/hooks";
import { errorText, useLive } from "../data/live";
import { securityData } from "../data/security";
import { DEMO_SECURITY_DATA } from "../sim/securityWorkspace";
import { SecurityWorkspace } from "./SecurityWorkspace";

export function Security({ route = "security" }: { route?: string }) {
  return useLive() ? <LiveSecurity route={route} /> : <SecurityWorkspace route={route} data={DEMO_SECURITY_DATA} />;
}

function LiveSecurity({ route }: { route: string }) {
  const result = useSecurity(60_000);
  return <SecurityWorkspace route={route} data={securityData(result.data)} loading={!result.data && !result.error} error={result.error ? errorText(result.error) : undefined} reload={result.reload} />;
}
