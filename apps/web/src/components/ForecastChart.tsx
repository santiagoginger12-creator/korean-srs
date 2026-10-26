// Hand-written SVG bar chart for the review forecast (no chart library). One accent colour,
// muted gridlines, "+N" labels over non-empty bars, local-time axis labels. Scales with its
// container via viewBox, so it stays legible at 390 px. Each bar carries a <title> and an
// aria-label ("Tue 14:00: 3 reviews, 7 total").
import type { Bar } from '../state/dashboard.ts';

interface Props {
  bars: Bar[];
  label: string;
  testId?: string;
  /** Overdue + current-hour reviews included in the first bar; spelled out in the caption. */
  dueNow?: number;
}

const W = 340;
const H = 132;
const PAD = { l: 22, r: 4, t: 16, b: 20 };

const niceMax = (n: number): number => {
  if (n <= 4) return 4;
  const step = n <= 10 ? 2 : n <= 25 ? 5 : n <= 50 ? 10 : n <= 100 ? 20 : Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / step) * step;
};

export function ForecastChart({ bars, label, testId, dueNow }: Props): JSX.Element {
  const total = bars.length ? bars[bars.length - 1]!.cumulative : 0;
  const max = niceMax(Math.max(0, ...bars.map((b) => b.count)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / Math.max(1, bars.length);
  const bw = Math.max(3, Math.min(28, slot * 0.66));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const plusFont = slot < 16 ? 8.5 : 10;

  return (
    <figure className="chart" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${label}: ${total} review${total === 1 ? '' : 's'}`}>
        {[0, max / 2, max].map((v) => (
          <g key={v} className="chart-grid">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            {Number.isInteger(v) && <text x={PAD.l - 4} y={y(v) + 3.5} textAnchor="end">{v}</text>}
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const h = (b.count / max) * ih;
          const desc = `${b.long}: ${b.count} review${b.count === 1 ? '' : 's'}, ${b.cumulative} total`;
          return (
            <g key={b.t} className="chart-bar" data-count={b.count} data-index={i}>
              <title>{desc}</title>
              <rect x={cx - bw / 2} y={PAD.t + ih - h} width={bw} height={Math.max(0, h)} rx={Math.min(3, bw / 3)} role="img" aria-label={desc} />
              {b.count > 0 && <text className="chart-plus" x={cx} y={PAD.t + ih - h - 3} textAnchor="middle" fontSize={plusFont}>+{b.count}</text>}
              {b.label && <text className="chart-x" x={cx} y={H - 6} textAnchor="middle">{b.label}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption>{label} · <strong>{total}</strong> total{dueNow ? ` (${dueNow} due now)` : ''}</figcaption>
    </figure>
  );
}
