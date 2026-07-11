import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  STATUS_LABELS, PRIORITY_LABELS, type Stats, type Status, type Priority,
} from '../lib/types';

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!stats) return <div className="center muted">Loading dashboard…</div>;

  const maxStatus = Math.max(1, ...Object.values(stats.byStatus));

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="kpi-grid">
        <KpiCard label="Open tickets" value={stats.open} tone="default" />
        <KpiCard label="Unassigned" value={stats.unassigned} tone={stats.unassigned > 0 ? 'warn' : 'default'} />
        <KpiCard label="SLA at risk" value={stats.slaAtRisk} tone={stats.slaAtRisk > 0 ? 'warn' : 'default'} />
        <KpiCard label="SLA breached" value={stats.slaBreached} tone={stats.slaBreached > 0 ? 'danger' : 'good'} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>By status</h2>
          {(Object.keys(stats.byStatus) as Status[]).map((s) => (
            <div key={s} className="bar-row">
              <span className="bar-label">{STATUS_LABELS[s]}</span>
              <div className="bar-track">
                <div className={`bar-fill status-${s}`} style={{ width: `${(stats.byStatus[s] / maxStatus) * 100}%` }} />
              </div>
              <span className="bar-value">{stats.byStatus[s]}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>By priority</h2>
          {(Object.keys(stats.byPriority) as Priority[]).map((p) => (
            <div key={p} className="bar-row">
              <span className="bar-label">{PRIORITY_LABELS[p]}</span>
              <div className="bar-track">
                <div className={`bar-fill priority-${p}`}
                  style={{ width: `${(stats.byPriority[p] / Math.max(1, stats.total)) * 100}%` }} />
              </div>
              <span className="bar-value">{stats.byPriority[p]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="quick-links">
        <Link to="/tickets?assignee=unassigned" className="btn-ghost">View unassigned →</Link>
        <Link to="/tickets?status=open" className="btn-ghost">View open →</Link>
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: 'default' | 'good' | 'warn' | 'danger' }) {
  return (
    <div className={`card kpi kpi-${tone}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
