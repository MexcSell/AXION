import { createHash } from 'node:crypto';
import { canonicalJson, type ExecProfile } from '../../../shared/contracts/src/exec-profile.ts';

/** sha256 (hex) of the canonical JSON of a profile. Array order is part of the hash. Binding this hash into an approval digest is a later item.
 *  Kept out of shared/contracts (c94 merge fix): that folder is typechecked by the web project, which has no node:crypto. */
export function execProfileSha256(profile: ExecProfile): string {
  return createHash('sha256').update(canonicalJson(profile)).digest('hex');
}
