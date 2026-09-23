import type { Category } from '../../shared/catalog';

export type IconName =
  | 'wheelchair'
  | 'route'
  | 'plus'
  | 'back'
  | 'close'
  | 'filter'
  | 'camera'
  | 'check'
  | 'alert'
  | 'crosshair'
  | 'chevron'
  | 'flag'
  | 'refresh'
  | Category;

const PATHS: Record<IconName, React.ReactNode> = {
  wheelchair: (
    <>
      <circle cx="11" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
      <path d="M11 8v5h5l2.5 5" />
      <path d="M8 10.5a5.5 5.5 0 1 0 7.2 6.6" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  flag: <path d="M6 21V4h10l-2 4 2 4H6" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  curb: <path d="M3 17h7v-6h11" />,
  stairs: <path d="M3 19h4v-4h4v-4h4V7h6" />,
  elevator: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <path d="M12 6.5l-2.5 3h5zM12 17.5l-2.5-3h5z" fill="currentColor" />
    </>
  ),
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Круглый значок категории в цвете состояния — повторяет маркер на карте. */
export function CategoryBadge({ category, cls, size = 36 }: { category: Category; cls: string; size?: number }) {
  return (
    <span className={`badge badge--${cls}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={category} size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Фирменный знак: съезд с бордюра над тактильной полосой. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="120" fill="#FFC400" />
      <path d="M112 330 H224 V214 H400" fill="none" stroke="#16324F" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" />
      <g fill="#16324F" opacity="0.55">
        {[150, 208, 266, 324, 382].map((x) => (
          <circle key={x} cx={x} cy={414} r={16} />
        ))}
      </g>
    </svg>
  );
}
