import { isApi } from '@/api/mode';
import { isAdmin, useMe } from '@/store/auth';

/** Creating and editing agents: administrators in api mode (members see the pages read-only; the server answers 403 anyway). Demo mode is unchanged. */
export function useCanEditAgents(): boolean {
  const me = useMe();
  return !isApi() || isAdmin(me);
}
