import { MARK_THEMED } from "@/lib/brand";

/** The mark, inline, so it inherits the theme.
 *
 *  Inlined rather than an <img>, because an image cannot resolve --ink and the mark has to survive
 *  the dark theme: the same hex that reads as ink on paper is invisible on dark paper. The markup is
 *  a module constant of ours, never user input, which is what makes dangerouslySetInnerHTML safe
 *  here and would not make it safe elsewhere.
 *
 *  Decorative by default: it sits beside the word "sloptic" everywhere it appears, so announcing it
 *  would make a screen reader say the name twice.
 */
export default function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ? `brand-mark ${className}` : "brand-mark"}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: MARK_THEMED }}
    />
  );
}
