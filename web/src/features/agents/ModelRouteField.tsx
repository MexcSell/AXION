import { useId } from 'react';
import { useCloudModels } from '@/api/cloudModel';
import { Field } from '@/components/ui/Form';

export function ModelRouteField({value, onChange, required}: {value: string; onChange: (s: string) => void; required?: boolean}) {
  const id = useId();
  const {data} = useCloudModels();
  const names = [...new Set(data?.models.filter(m => m.enabled).map(m => m.model))];
  return <Field label="Model route" required={required} help="models.route">
    <input className="input" list={id} aria-label="Model route" value={value} onChange={e => onChange(e.target.value)} />
    <datalist id={id}>{names.map(name => <option key={name} value={name} />)}</datalist>
  </Field>;
}
