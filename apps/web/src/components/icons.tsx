/** Small inline SVG icons (no icon library needed). */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Shield = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const Check = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={3}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);
export const Cross = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={3}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Alert = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.5}>
    <path d="M12 8v5M12 17h.01" />
  </svg>
);
export const Stop = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
    <path d="M15 9l-6 6M9 9l6 6" />
  </svg>
);
export const Warn = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);
export const Search = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
export const External = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" />
  </svg>
);
