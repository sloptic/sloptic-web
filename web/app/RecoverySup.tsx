import type { RecoveryMarks } from "@/lib/grades";

/** The recovery letters, shared by the field, the board, and the report header: N recovered nothing
 *  across the passes, P recovered some, F recovered all, L marks a limited battery. Titles carry the
 *  meaning; the letters stay quiet enough to sit beside a score or a link. */
export default function RecoverySup({ marks }: { marks?: RecoveryMarks | null }) {
  if (!marks) return null;
  return (
    <>
      {marks.none && (
        <sup className="prov-mark" title="The retries recovered nothing: a challenge held every time.">
          N
        </sup>
      )}
      {marks.partial && (
        <sup className="prov-mark" title="The retries recovered some blocked checks, not all.">
          P
        </sup>
      )}
      {marks.full && (
        <sup className="prov-mark" title="The retries recovered every blocked check.">
          F
        </sup>
      )}
      {marks.limited && (
        <sup className="prov-mark" title="Limited: fewer than 40 checks applied, or a challenge cut the battery short.">
          L
        </sup>
      )}
    </>
  );
}
