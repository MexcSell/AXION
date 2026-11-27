import { Sparkles, GitCommitHorizontal, FileDiff, ShieldAlert, ClipboardCheck, Hourglass } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { EvolveInfo, EvolveState } from '../../data/types';

/**
 * Evolution step 2: what an `improve` mission shows once the host runner has written `presentation.evolve`.
 * Pure on purpose (relative imports only, no store): the same component renders on the Results and Reports tabs and in the tests.
 */

export const EVOLVE_STATE: Record<EvolveState, { label: string; hue: number; note: string }> = {
  queued: { label: 'Queued', hue: 225, note: 'Waiting for the runner to pick this mission up.' },
  claimed: { label: 'Picked up', hue: 210, note: 'The runner has taken the mission and is preparing a workspace.' },
  working: { label: 'Engineer at work', hue: 265, note: 'The engineer agent is changing the code.' },
  checking: { label: 'Checking', hue: 45, note: 'Tests and checks are running on the change.' },
  deploying: { label: 'Going live', hue: 190, note: 'The change passed its checks and is being deployed.' },
  live: { label: 'Live', hue: 150, note: 'The change is deployed on this site.' },
  rejected: { label: 'Rejected', hue: 0, note: 'The checks did not pass, so the change was not deployed.' },
  rolled_back: { label: 'Rolled back', hue: 25, note: 'The change was deployed, failed its watch period and was rolled back.' },
  needs_owner: { label: 'Needs the owner', hue: 320, note: 'The change touches a protected area, so it waits for the owner to decide.' },
  failed: { label: 'Failed', hue: 0, note: 'The runner could not complete this change.' },
};

export const shortCommit = (c: string) => c.slice(0, 7);

function Chip({ hue, children }: { hue: number; children: ReactNode }) {
  return <span className="chip" style={{ ['--h' as string]: hue }}>{children}</span>;
}

function StateHeader({ e }: { e: EvolveInfo }) {
  const s = EVOLVE_STATE[e.state] ?? { label: e.state, hue: 225, note: '' };
  const updated = e.updatedAt ? new Date(e.updatedAt) : null;
  const validUpdated = updated && !Number.isNaN(updated.getTime()) ? updated : null;
  return (
    <div className="subpanel evo-head">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Sparkles size={16} className="info" />
        <b>Change to AXION</b>
        <Chip hue={s.hue}><span className="dot sm" />{s.label}</Chip>
        {e.attempt > 1 && <span className="dim">attempt {e.attempt}</span>}
        <span className="spacer" />
        <time className="dim" dateTime={validUpdated ? e.updatedAt : undefined} style={{ fontSize: 12 }}>updated {validUpdated ? validUpdated.toLocaleString() : '—'}</time>
      </div>
      {s.note && <p className="dim" style={{ margin: '6px 0 0', fontSize: 12.5 }}>{s.note}</p>}
    </div>
  );
}

/** Above this many changed files the list starts collapsed to the first FILES_SHOWN with a "Show all N files" button. */
export const FILES_SHOWN = 20;

/** The files the list shows: all of them when expanded or when there are FILES_SHOWN or fewer, otherwise the first FILES_SHOWN. */
export const visibleFiles = (files: string[], expanded: boolean): string[] =>
  expanded || files.length <= FILES_SHOWN ? files : files.slice(0, FILES_SHOWN);

function FilesList({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const long = files.length > FILES_SHOWN;
  return (
    <>
      <ul className="evo-files" id={long ? 'evo-files-list' : undefined}>{visibleFiles(files, expanded).map((f) => <li key={f}><code>{f}</code></li>)}</ul>
      {long && (
        <button type="button" className="btn sm ghost" style={{ marginTop: 4 }} aria-expanded={expanded} aria-controls="evo-files-list" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer files' : `Show all ${files.length} files`}
        </button>
      )}
    </>
  );
}

function ChangePanel({ e }: { e: EvolveInfo }) {
  if (!e.commit && !e.filesChanged?.length && !e.diffStat) return null;
  return (
    <div className="subpanel evo-change">
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <GitCommitHorizontal size={15} className="info" /><b>Commit</b>
        {e.commit ? <code className="evo-sha" title={e.commit}>{shortCommit(e.commit)}</code> : <span className="dim">none yet</span>}
        {e.base && <span className="dim">on top of <code className="evo-sha" title={e.base}>{shortCommit(e.base)}</code></span>}
      </div>
      {e.filesChanged?.length ? (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}><FileDiff size={15} className="info" /><b>Files changed ({e.filesChanged.length})</b></div>
          <FilesList files={e.filesChanged} />
        </>
      ) : null}
      {e.diffStat && <pre className="evo-pre" aria-label="Diff summary">{e.diffStat}</pre>}
    </div>
  );
}

function ReportPanel({ e }: { e: EvolveInfo }) {
  if (!e.report) return null;
  return (
    <div className="subpanel">
      <div className="row" style={{ gap: 8, marginBottom: 6 }}><ClipboardCheck size={15} className="good" /><b>Report</b></div>
      <div className="evo-report">{e.report}</div>
    </div>
  );
}

function ChecksPanel({ e }: { e: EvolveInfo }) {
  const g = e.guard;
  if (!e.checks && !g && !e.hits?.length) return <div className="subpanel"><span className="dim"><Hourglass size={13} /> No check results recorded yet.</span></div>;
  return (
    <>
      {e.hits?.length ? (
        <div className="subpanel evo-hits">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}><ShieldAlert size={15} className="warn" /><b>Protected areas touched</b></div>
          <ul className="evo-files">{e.hits.map((h) => <li key={h}><code>{h}</code></li>)}</ul>
        </div>
      ) : null}
      {e.checks && (
        <div className="subpanel">
          <div className="row" style={{ gap: 8, marginBottom: 6 }}><ClipboardCheck size={15} className="info" /><b>Checks</b></div>
          <pre className="evo-pre">{e.checks}</pre>
        </div>
      )}
      {g && (
        <div className="subpanel">
          <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}><ShieldAlert size={15} className="info" /><b>Guard</b><Chip hue={g.outcome === 'live' || g.outcome === 'ok' ? 150 : 25}>{g.outcome}</Chip>
            {g.failedStep && <span className="dim">failed at <code>{g.failedStep}</code></span>}</div>
          {g.reason && <div className="evo-report">{g.reason}</div>}
        </div>
      )}
    </>
  );
}

/** `results`: what changed. `reports`: how it was checked. The report text is on both. */
export function EvolveReport({ evolve, view }: { evolve: EvolveInfo; view: 'results' | 'reports' }) {
  return (
    <div className="col evo" style={{ gap: 10 }} data-evolve-state={evolve.state}>
      <StateHeader e={evolve} />
      {view === 'results' ? <ChangePanel e={evolve} /> : <ChecksPanel e={evolve} />}
      <ReportPanel e={evolve} />
    </div>
  );
}

/**
 * The "Improve AXION itself" choice of the Add mission dialog. Only administrators see it (the server refuses anyone else with 403).
 * `help` is the dialog's HelpTrigger; the one-line explanation is always visible next to it.
 */
export function ImproveOption({ admin, checked, onChange, help }: { admin: boolean; checked: boolean; onChange: (v: boolean) => void; help?: ReactNode }) {
  if (!admin) return null;
  return (
    <div className={`ma-improve${checked ? ' on' : ''}`}>
      <label className="ma-improve-l">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <Sparkles size={15} className="info" aria-hidden />
        <b>Improve AXION itself — agents change this website</b>
      </label>
      {help}
      <span className="dim ma-improve-help">An engineer agent changes AXION's code; checks run; it goes live automatically unless it touches a protected area</span>
    </div>
  );
}
