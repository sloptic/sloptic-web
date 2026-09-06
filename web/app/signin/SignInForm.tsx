"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/** Providers appear only when configured, so enabling GitHub or Google is a config change plus an
 *  env var, never a code change: Supabase treats every provider as the same OAuth handshake, and
 *  they all land on /auth/callback. */
const OAUTH: { id: "github" | "google"; label: string }[] = [
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
];

export default function SignInForm({
  url,
  anonKey,
  providers,
  next,
}: {
  url: string;
  anonKey: string;
  providers: string[];
  next: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supabase = createBrowserClient(url, anonKey);
  const site = typeof window !== "undefined" ? window.location.origin : "";
  // OAuth returns a code to exchange, so it lands on /auth/callback.
  const oauthRedirectTo = `${site}/auth/callback?next=${encodeURIComponent(next)}`;
  // The emailed link is built by the template from {{ .RedirectTo }} plus the token hash, so this
  // is the base it appends to. It has to keep a query string for that append to stay valid, which
  // ?next= always gives it. Whatever origin is used here must also be listed under Supabase's
  // allowed redirect URLs, or Supabase silently falls back to the Site URL and next is lost.
  const emailRedirectTo = `${site}/auth/confirm?next=${encodeURIComponent(next)}`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function oauth(provider: "github" | "google") {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: oauthRedirectTo } });
    if (error) setError(error.message);
  }

  if (sent) {
    return (
      <p className="status" role="status">
        Check {email} for the link.
      </p>
    );
  }

  const enabled = OAUTH.filter((p) => providers.includes(p.id));

  return (
    <>
      <form onSubmit={sendLink} className="grade-form">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address"
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? "sending" : "email me a link"}
        </button>
      </form>

      {enabled.length > 0 && (
        <div className="cta-row" style={{ marginTop: "1rem" }}>
          {enabled.map((p) => (
            <button key={p.id} className="button secondary" onClick={() => oauth(p.id)} type="button">
              Continue with {p.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {/* Next to the buttons, not buried in the footer. What makes terms binding is that someone had
          reasonable notice and acted anyway, and a link beside the control they press is that notice;
          a footer link on its own generally is not. This sentence is also what makes the
          terms_accepted_at stamp in the auth callback honest. */}
      <p className="signin-terms">
        Signing in accepts the <a href="/terms">terms of use</a> and the{" "}
        <a href="/privacy">privacy policy</a>.
      </p>
    </>
  );
}
