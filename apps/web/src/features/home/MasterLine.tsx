// Dashboard line for the master vocab list (docs/MASTER_LIST.md), linking to Data → Master list.
import { useMasterList } from '../../data/master.ts';
import { tz } from '../../state/clock.ts';
import { localDateTime } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';

export function MasterLine(): JSX.Element {
  const d = useApp().derived!;
  const v = useMasterList(d, tz);
  const last = v.ext.lastExport ? localDateTime(v.ext.lastExport.at).slice(0, 10) : 'never';
  return (
    <p className="small muted master-line" data-testid="master-line">
      <a href="#/data">Master list</a>: {v.rows ? <span data-testid="master-learning">{v.learning.toLocaleString('en-US')}</span> : '…'} learning · last export {last}
    </p>
  );
}
