import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import GradeList from "./GradeList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your grades",
  // The page is per-visitor and links to reports, so it has no business in an index.
  robots: { index: false, follow: false },
};

// Signed in, this page had nothing of its own: /account renders the SAME GradeList with the same
// data, one section down from the events and domains that belong to the same person. So the account
// page owns it and this one hands over.
//
// It is not deleted, because signed out it is the only place a browser's own history exists. That
// list comes from localStorage, /account requires an account by definition, and a report link is the
// one thing an anonymous visitor has: taking this away would strand them with no way back to a grade
// they ran except the tab they closed.
export default async function GradesPage() {
  const user = await currentUser();
  if (user) redirect("/account");

  return (
    <>
      <div className="page-head">
        <h1>Your grades</h1>
        <p className="page-lead">
          Grades this browser has run. They live here until they expire, or until you sign in and
          keep them.
        </p>
      </div>
      <GradeList signedIn={false} />
    </>
  );
}
