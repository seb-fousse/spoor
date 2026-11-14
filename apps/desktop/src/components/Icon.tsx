import type { ReactNode } from "react";

interface IconProps {
  /** Width and height in pixels. Leave it out to size the icon from `className`, such as to 1em. */
  size?: number;
  className?: string;
  /** The icon's shapes, on a 24 × 24 grid. */
  children: ReactNode;
}

/**
 * A line icon, drawn like the app's others: round 2-unit strokes on a 24-unit
 * grid, in the text colour. Icons sit beside a label, so they are hidden from
 * assistive tech.
 */
export function Icon({ size, className, children }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
