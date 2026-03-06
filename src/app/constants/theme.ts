/**
 * Flux design tokens.
 * Hex values are for reference / non-CSS usage (e.g. SVG fill).
 * Prefer CSS variables in theme.css for styling so one change updates the app.
 */

export const FLUX_COLORS = {
  primary: "#e6007e",
  primaryHover: "#c4006b",
  primaryMuted: "#fdf2f8",
} as const;

/** CSS variable names for use in Tailwind arbitrary values: bg-[var(--flux-primary)] */
export const FLUX_CSS_VARS = {
  primary: "var(--flux-primary)",
  primaryHover: "var(--flux-primary-hover)",
  primaryMuted: "var(--flux-primary-muted)",
  ring: "var(--flux-ring)",
  codeBg: "var(--flux-code-bg)",
  codeHeader: "var(--flux-code-header)",
  codeBorder: "var(--flux-code-border)",
  textMuted: "var(--flux-text-muted)",
  textDefault: "var(--flux-text-default)",
  border: "var(--flux-border)",
  borderLight: "var(--flux-border-light)",
  bgSubtle: "var(--flux-bg-subtle)",
  bgEmpty: "var(--flux-bg-empty)",
} as const;

/** Reusable Tailwind class segments for brand primary (button, link, focus ring) */
export const FLUX_CLASSES = {
  buttonPrimary:
    "bg-[var(--flux-primary)] hover:bg-[var(--flux-primary-hover)] text-white",
  iconPrimary: "text-[var(--flux-primary)]",
  iconPrimaryHover:
    "text-[var(--flux-primary)] group-hover:text-[var(--flux-primary)]",
  focusRing: "focus-within:ring-1 focus-within:ring-[var(--flux-ring)]",
  linkHover: "hover:text-[var(--flux-primary)] hover:bg-[var(--flux-primary-muted)]",
  borderHover: "hover:border-pink-300",
} as const;
