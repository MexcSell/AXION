// Classify a diff against the protected-path rules (evolve/protected.txt). Pure; no I/O.
// Rules are globs: `*` = any characters inside one path segment, `**` = any number of whole segments (also none).
// A rule prefixed `modify:` matches only changes to existing files: every status except A (new file). A rename is
// checked on both its old and its new path. Unknown statuses count as modifications (fail closed).

export type ChangeStatus = 'A' | 'M' | 'D' | 'R';
export type ClassifyInput = { path: string; status: ChangeStatus; oldPath?: string };

const MODIFY = 'modify:';

export function parseRules(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

export function globToRegExp(glob: string): RegExp {
  const parts = glob.split('/');
  let re = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const last = i === parts.length - 1;
    if (part === '**') {
      // `**` as a whole segment: any number of segments. Trailing `a/**` needs at least one more segment.
      re += last ? '.+' : '(?:[^/]+/)*';
      continue;
    }
    re += part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    if (!last) re += '/';
  }
  return new RegExp(`^${re}$`);
}

type Rule = { re: RegExp; modifyOnly: boolean };

function compile(rules: string[]): Rule[] {
  return rules.map((r) => {
    const modifyOnly = r.startsWith(MODIFY);
    return { re: globToRegExp(modifyOnly ? r.slice(MODIFY.length) : r), modifyOnly };
  });
}

export function classify(paths: ClassifyInput[], rules: string[]): { hits: string[] } {
  const compiled = compile(rules);
  const hits: string[] = [];
  const add = (p: string) => { if (!hits.includes(p)) hits.push(p); };
  for (const c of paths) {
    const isNew = c.status === 'A';
    const candidates = c.oldPath !== undefined && c.oldPath !== c.path ? [c.oldPath, c.path] : [c.path];
    for (const p of candidates) {
      if (compiled.some((r) => (!r.modifyOnly || !isNew) && r.re.test(p))) add(p);
    }
  }
  return { hits };
}

/** True when any changed path (old or new side of a rename) matches the glob. Used for "touches server/migrations/**". */
export function touches(paths: ClassifyInput[], glob: string): boolean {
  const re = globToRegExp(glob);
  return paths.some((c) => re.test(c.path) || (c.oldPath !== undefined && re.test(c.oldPath)));
}
