import { Crosshair } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useUserForecasts } from '@/api/forecasts';
import { ForecastLedgerView } from '@/features/settings/MyForecasts';
import type { DialogComponentProps } from '@/dialogs/DialogHost';

/* DL-101: one person's forecast record (administrators, c89). The server answers one person at a time and refuses everyone else; there is no list of people ordered by score. */
function UserForecasts({ close, props }: DialogComponentProps<{ userId?: string; name?: string }>) {
  const read = useUserForecasts(props.userId ?? null);
  return (
    <Modal title={`Forecasts of ${props.name ?? 'this person'}`} icon={Crosshair} help="forecasts.user" dialogId="DL-101" size="xl" onClose={close}
      sub="One person at a time. Scores come from tasks that person forecast before their first review.">
      <ForecastLedgerView read={read} who={props.name} />
    </Modal>
  );
}
export const dialogs = { 'user-forecasts': UserForecasts };
