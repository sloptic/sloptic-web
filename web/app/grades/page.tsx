import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import GradeList from "./GradeList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your grades",
  // The page is per-visitor and links to reports, so it has no business in an index.
  robots: { index: false, follow: false },
};

export default async function GradesPage() {
  const user = await currentUser();
  return (
    <>
      <div className="page-head">
        <h1>Your grades</h1>
        <p className="page-lead">
          Grades you ran, whether or not you were signed in when you ran them.
        </p>
      </div>
      <GradeList signedIn={!!user} />
    </>
  );
}
