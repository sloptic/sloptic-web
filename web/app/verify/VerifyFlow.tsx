"use client";

import { useCallback, useEffect, useState } from "react";
import type { Claim } from "@/lib/domain-claims";

export type { Claim };

/** One factor's state in words.
 *
 *  Three states, never two, and this is the whole reason the columns are tri-state: "we could not
 *  look" is not "it is not there". Telling someone their token is missing when their server refused
 *  us, or when their DNS provider timed out, sends them to re-publish something already correct.
 */
function factorLine(status: Claim["file_status"], kind: "file" | "record"): string {
  switch (status) {
    case "ok":
      return "found";
    case "not_found":
      return kind === "file" ? "not there yet" : "no matching record yet";
    case "blocked":
      return "could not check, we will try again";
    default:
      return "not checked yet";
  }
}

function Factor({ label, status, kind, children }: {
  label: string;
  status: Claim["file_status"];
  kind: "file" | "record";
  children: React.ReactNode;
}) {
  return (
    <div className="card" data-state={status ?? "pending"}>
      <h3>
        {label} <span className="tag">{factorLine(status, kind)}</span>
      </h3>
      {children}
    </div>
  );
}

export default function VerifyFlow({ signedIn, initialClaims }: {
  signedIn: boolean;
  initialClaims: Claim[];
}) {
  const [claims, setClaims] = useState<Claim[]>(initialClaims);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/verify/claim", { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const d = await r.json().catch(() => null);
      if (d?.claims) setClaims(d.claims);
    }
  }, []);

  // Only while something is actually pending. A verified origin does not change on its own, and a
  // page that polls for ever is the thing this product grades other people for.
  useEffect(() => {
    if (!claims.some((c) => c.status === "pending")) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [claims, load]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      // The attestation travels with the request that creates the claim, so there is no path to a
      // token without it.
      const d = await post("/api/verify/claim", { url, attest: true });
      setUrl("");
      setClaims((prev) => [d.claim, ...prev.filter((c) => c.id !== d.claim.id)]);
      if (d.existing) setNote("You already have a claim for that origin, so here it is again.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not start verification.");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, path: string, then: string) {
    setBusy(true);
    setNote(null);
    try {
      await post(path, { id });
      setNote(then);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <p className="section-intro">
        <a href="/signin?next=/verify">Sign in</a> to verify a site you own. Permission attaches to
        an account, so there is nothing to verify against until there is one.
      </p>
    );
  }

  return (
    <>
      <form className="add-report" onSubmit={start}>
        <label htmlFor="verify-url">Add new domain</label>
        <div className="add-report-row">
          <input
            id="verify-url"
            type="text"
            inputMode="url"
            placeholder="https://your-app.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="button" type="submit" disabled={busy || !url.trim()}>
            {busy ? "working..." : "Get a token"}
          </button>
        </div>
        <p className="fineprint">
          Starting this records that you own the site and authorize active testing of it.
        </p>
      </form>
      {note && <p className="section-intro">{note}</p>}

      {claims.map((c) => (
        <section className="section attached" key={c.id}>
          <h2 className="section-head">{c.origin}</h2>

          {c.status === "verified" ? (
            <>
              <p className="section-intro">
                Verified{c.verified_at ? ` on ${new Date(c.verified_at).toLocaleDateString()}` : ""}.
                The full battery runs on this origin for your account. Anyone else who submits it
                still gets the passive floor.
              </p>
              <div className="run-controls">
                <a className="button" href="/">Grade it</a>
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(
                      `Give up verification for ${c.origin}? Active grading stops immediately. You can verify it again later.`
                    )) return;
                    void act(c.id, "/api/verify/revoke", "Verification given up.");
                  }}
                >
                  Give it up
                </button>
              </div>
            </>
          ) : c.status === "pending" ? (
            <>
              <p className="section-intro">
                Publish this token in both places. Both are needed: one proves you control what the
                site serves, the other proves you control its DNS. Either alone is a proof somebody
                with a foothold could fake.
              </p>
              <div className="card-grid">
                <Factor label="The file" status={c.file_status} kind="file">
                  <p>
                    Serve it at <code>{c.origin}/.well-known/sloptic-verification.txt</code>, with the
                    token as the whole body.
                  </p>
                  <pre className="token-block"><code>{c.token}</code></pre>
                </Factor>
                <Factor label="The DNS record" status={c.dns_status} kind="record">
                  <p>
                    Add a TXT record at <code>_sloptic.{c.host}</code> with the same value. DNS can
                    take a while to propagate, which is normal.
                  </p>
                  <pre className="token-block"><code>{c.token}</code></pre>
                </Factor>
              </div>
              <div className="run-controls">
                <button className="button" type="button" disabled={busy}
                        onClick={() => void act(c.id, "/api/verify/recheck", "Checking now.")}>
                  Check now
                </button>
              </div>
              {c.checked_at && (
                <p className="fineprint">
                  Last checked {new Date(c.checked_at).toLocaleTimeString()}.
                  {c.detail ? ` ${c.detail}` : ""}
                </p>
              )}
            </>
          ) : (
            <p className="section-intro">
              This claim is {c.status}. Start again above if you still want to verify this origin.
            </p>
          )}
        </section>
      ))}
    </>
  );
}
