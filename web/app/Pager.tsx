"use client";

import { useEffect, useState } from "react";

/** Paging, in one place.
 *
 *  The board, the three lists beside it and the account's grade table all page the same way, and by
 *  the third copy the clamp below had been written three times. It is the part that looks optional
 *  and is not: every one of these lists shrinks under something (a retry recovers a score and the
 *  row leaves for the board, a grade is deleted, a refresh re-reads the gallery), and a page index
 *  that outlives its list renders an empty table that reads as data loss.
 */

export const PAGE_SIZE = 25;

export function usePaged<T>(rows: T[], pageSize: number = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const from = Math.min(page, last) * pageSize;
  const shown = rows.slice(from, from + pageSize);
  useEffect(() => {
    if (page > last) setPage(last);
  }, [page, last]);
  return { shown, page, setPage, last, from, pageSize, total: rows.length };
}

/** Spread a usePaged result straight in: `<Pager {...paged} />`. Declared on its own rather than as
 *  ReturnType<typeof usePaged> so the component does not inherit the hook's generic, which would
 *  make every caller's row type part of this signature for no reason. */
export type PagerProps = {
  page: number;
  setPage: (n: number) => void;
  last: number;
  from: number;
  pageSize: number;
  total: number;
};

export default function Pager({ page, setPage, last, from, pageSize, total }: PagerProps) {
  // Nothing to steer through, so nothing to draw. Kept here rather than at each call site, where it
  // was the line most likely to be forgotten.
  if (total <= pageSize) return null;
  return (
    <div className="pager">
      <button className="link-button" type="button" disabled={page === 0} onClick={() => setPage(0)}>
        first
      </button>
      <button className="link-button" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
        previous
      </button>
      <span>
        {from + 1} to {Math.min(from + pageSize, total)} of {total}
      </span>
      <button className="link-button" type="button" disabled={page >= last} onClick={() => setPage(page + 1)}>
        next
      </button>
      <button className="link-button" type="button" disabled={page >= last} onClick={() => setPage(last)}>
        last
      </button>
    </div>
  );
}
