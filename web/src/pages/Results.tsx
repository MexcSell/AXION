import { useEffect, useState } from 'react';
import { FileBox, GitBranch, Package, RefreshCw } from 'lucide-react';
import type { ArtifactDetailDto, ArtifactsDto, ReleasesDto } from '@contracts';
import { api } from '@/api/client';
import { TopBoard, FrameBody } from '@/components/layout/PageFrame';
import { Panel } from '@/components/ui/Panel';
import { useTab } from '@/hooks/useTab';
import { plainError } from '@/lib/plainError';
import { isAdmin, useMe } from '@/store/auth';

function useRecords<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const stop = new AbortController();
    setData(undefined);
    setError('');
    api<T>('GET', path, undefined, { signal: stop.signal })
      .then(result => { if (!stop.signal.aborted) setData(result); })
      .catch(e => { if (!stop.signal.aborted) setError(plainError(e)); });
    return () => stop.abort();
  }, [path, revision]);
  return { data, error, refresh: () => setRevision(n => n + 1) };
}

function Versions({ id }: { id: string }) {
  const { data, error, refresh } = useRecords<ArtifactDetailDto>('/artifacts/' + encodeURIComponent(id));
  if (error) return <div role="alert">{error} <button className="btn sm" onClick={refresh}>Retry</button></div>;
  if (!data) return <span role="status">Loading versions…</span>;
  return <ul>{data.versions.map(v => <li key={v.version}>v{v.version} · {v.mediaType} · {v.sizeBytes.toLocaleString()} bytes · {v.producer}
    <div className="mono dim" style={{ overflowWrap: 'anywhere' }}>SHA-256 {v.sha256}</div></li>)}</ul>;
}

function ArtifactLibrary() {
  const { data, error, refresh } = useRecords<ArtifactsDto>('/artifacts');
  const [selected, setSelected] = useState('');
  return <Panel title="Artifacts" icon={FileBox} actions={<button className="btn sm" onClick={refresh}><RefreshCw size={14} />Refresh</button>}>
    {error ? <span role="alert">{error}</span> : !data ? <span role="status">Loading artifacts…</span> : data.artifacts.length === 0 ? <p>No artifacts have been recorded.</p> :
      data.artifacts.map(a => <div className="subpanel" key={a.id}>
        <button className="btn ghost" aria-expanded={selected === a.id} onClick={() => setSelected(selected === a.id ? '' : a.id)}>{a.name} · {a.versionCount} {a.versionCount === 1 ? 'version' : 'versions'}</button>
        {selected === a.id && <Versions id={a.id} />}
      </div>)}
  </Panel>;
}

function Releases() {
  const { data, error, refresh } = useRecords<ReleasesDto>('/releases');
  return <Panel title="Releases" icon={GitBranch} actions={<button className="btn sm" onClick={refresh}><RefreshCw size={14} />Refresh</button>}>
    {error ? <span role="alert">{error}</span> : !data ? <span role="status">Loading releases…</span> : data.releases.length === 0 ? <p>No releases have been recorded.</p> :
      data.releases.map(r => <div className="subpanel" key={r.id}><b>{r.version}{data.lastGood?.releaseId === r.id && ' · last good'}</b><p>{r.what}</p>
        <small>{r.releasedByName} · {new Date(r.createdAt).toLocaleString()}</small></div>)}
  </Panel>;
}

export default function ResultsPage() {
  const [tab, setTab, tabs] = useTab('results');
  const admin = isAdmin(useMe());
  return <div className="page">
    <TopBoard title="Results & Versions" icon={Package} help="results.tabs" sub="Recorded artifacts, versions and releases."
      tabs={{ tabs, value: tab, onChange: setTab, icons: [FileBox, GitBranch], ariaLabel: 'Results views' }} />
    <FrameBody tab={tab} panel={false}>{admin ? tab === 'Library' ? <ArtifactLibrary /> : <Releases /> : <Panel title="Results">Administrator access is required to view these records.</Panel>}</FrameBody>
  </div>;
}
