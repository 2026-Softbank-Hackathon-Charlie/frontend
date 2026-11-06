import { useSecurity, useSecurityControls, useSecurityVulnerabilities } from "../api/hooks";
import { errorText, useLive } from "../data/live";
import { securityData } from "../data/security";
import { DEMO_SECURITY_DATA } from "../sim/securityWorkspace";
import { SecurityWorkspace } from "./SecurityWorkspace";

export function Security({ route = "security" }: { route?: string }) {
  return useLive() ? <LiveSecurity route={route} /> : <SecurityWorkspace route={route} data={DEMO_SECURITY_DATA} />;
}

function LiveSecurity({ route }: { route: string }) {
  const result = useSecurity(60_000);
  // Controls and vulnerabilities are separate APIs: an older server without them
  // leaves those tabs unavailable with the reason, while findings still load.
  const controls = useSecurityControls(60_000);
  const vulnerabilities = useSecurityVulnerabilities(60_000);
  const data = securityData(result.data, {
    controls: controls.data, controlsError: controls.error ? errorText(controls.error) : undefined,
    vulnerabilities: vulnerabilities.data, vulnerabilitiesError: vulnerabilities.error ? errorText(vulnerabilities.error) : undefined,
  });
  const reload = () => { result.reload(); controls.reload(); vulnerabilities.reload(); };
  return <SecurityWorkspace route={route} data={data} loading={!result.data && !result.error} error={result.error ? errorText(result.error) : undefined} reload={reload} />;
}
