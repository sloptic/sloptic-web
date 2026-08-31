import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";
import { currentUser, publicSupabaseConfig } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in or up",
  description: "Sign in or create an account to verify a domain or an event.",
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
        <h1>Sign in / up</h1>
        <p className="page-lead">
          One link does both. Only needed to prove a domain or an event is yours.
        </p>
      </div>

      <section className="section attached">
        {config ? (
          <SignInForm url={config.url} anonKey={config.key} providers={providers} next={next} />
        ) : (
          <p className="error">Sign-in is not configured yet.</p>
        )}
        {searchParams.error && (
          <p className="error" role="alert">
            That link did not work, request another.
          </p>
        )}
      </section>
    </>
  );
}
