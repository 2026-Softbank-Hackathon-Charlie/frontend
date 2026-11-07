import { useEnvironments, useSecurity, useSecurityControls, useSecurityVulnerabilities } from "../api/hooks";
import { errorText, useLive } from "../data/live";
import { securityData } from "../data/security";
import { DEMO_SECURITY_DATA } from "../sim/securityWorkspace";
import { SecurityWorkspace } from "./SecurityWorkspace";

export function Security({ route = "security" }: { route?: string }) {
  return useLive() ? <LiveSecurity route={route} /> : <SecurityWorkspace route={route} data={DEMO_SECURITY_DATA} />;
}

function LiveSecurity({ route }: { route: string }) {
  const result = useSecurity(60_000);
  const environments = useEnvironments(60_000);
  // Controls and vulnerabilities are separate APIs: an older server without them
  // leaves those tabs unavailable with the reason, while findings still load.
  const controls = useSecurityControls(60_000);
  const vulnerabilities = useSecurityVulnerabilities(60_000);
  const data = securityData(result.data, {
    environments: environments.data,
    findingsRequest: { loading: result.loading, error: result.error ? { status: result.error.status, code: result.error.code, message: errorText(result.error) } : undefined },
    controls: controls.data, controlsError: controls.error ? errorText(controls.error) : undefined,
    vulnerabilities: vulnerabilities.data, vulnerabilitiesError: vulnerabilities.error ? errorText(vulnerabilities.error) : undefined,
    controlsRequest: { loading: controls.loading, error: controls.error ? { status: controls.error.status, code: controls.error.code, message: errorText(controls.error) } : undefined },
    vulnerabilitiesRequest: { loading: vulnerabilities.loading, error: vulnerabilities.error ? { status: vulnerabilities.error.status, code: vulnerabilities.error.code, message: errorText(vulnerabilities.error) } : undefined },
  });
  const reload = () => { result.reload(); environments.reload(); controls.reload(); vulnerabilities.reload(); };
  return <SecurityWorkspace route={route} data={data} loading={result.loading && controls.loading && vulnerabilities.loading} error={result.error ? errorText(result.error) : undefined} reload={reload} />;
}
