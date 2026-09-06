"use client";

import { forgetEverything } from "@/lib/history";

/** Sign out, and take this browser's local grade list with it.
 *
 *  The list lives in localStorage so an anonymous submitter can find their reports again, which
 *  means it is scoped to the BROWSER and outlives the session. Without this, signing out and handing
 *  the laptop to someone else left your unsaved reports on their account page, with working links.
 *  A report URL is a bearer token: seeing the id is access to the report.
 *
 *  Cleared before the POST rather than after the redirect, because the redirect may not come back to
 *  a page of ours, and a cleanup that only runs sometimes is not a cleanup.
 */
export default function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      action="/auth/signout"
      method="post"
      className={className}
      onSubmit={() => forgetEverything()}
    >
      <button type="submit">Sign out</button>
    </form>
  );
}
