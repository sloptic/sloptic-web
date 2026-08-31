import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";
import { currentUser, publicSupabaseConfig } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to verify a domain or an event, which is what unlocks the checks that send real traffic.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const next = searchParams.next?.startsWith("/") ? searchParams.next : "/";
  if (await currentUser()) redirect(next);

  let config: { url: string; key: string } | null = null;
  try {
    config = publicSupabaseConfig();
  } catch {
    config = null;
  }

  // Enabled in the Supabase dashboard, listed here. Absent means the button is not shown, so a
  // provider that is not configured can never present a broken sign-in path.
  const providers = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return (
    <>
      <div className="page-head">
        <h1>Sign in</h1>
        <p className="page-lead">
          An account is needed only to prove a domain or an event is yours. Grading a single app
          passively needs nothing.
        </p>
      </div>

      <section className="section">
        {config ? (
          <SignInForm url={config.url} anonKey={config.key} providers={providers} next={next} />
        ) : (
          <p className="error">Sign-in is not configured yet.</p>
        )}
        {searchParams.error && (
          <p className="error" role="alert">
            That sign-in link did not work. Request another.
          </p>
        )}
        <p className="section-intro" style={{ marginTop: "1.5rem" }}>
          Signing in accepts the <a href="/terms">terms</a>, which is what makes an authorization to
          test traceable to a person.
        </p>
      </section>
    </>
  );
}
