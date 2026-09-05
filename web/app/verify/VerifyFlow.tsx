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

/** One proof, in every state the claim can be in.
 *
 *  Shown even once the claim is verified: the two proofs are the thing being tracked, and a verified
 *  origin that hides them cannot answer "which half am I looking at" or "is my record still there".
 *  Active grades re-check both every time, so they never stop mattering.
 *
 *  While a check is in flight the card says so by ANIMATING rather than by adding a sentence: the
 *  ellipsis carries it, the same way the event claim's slip does, and the accent bar keeps saying
 *  what the last look found instead of being blanked out by the new one.
 */
function Factor({ label, status, kind, checking, children }: {
  label: string;
  status: Claim["file_status"];
  kind: "file" | "record";
  checking: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card" data-state={status ?? "pending"}>
      <h3>
        {label}{" "}
        <span className="tag">
          {factorLine(status, kind)}
          {checking && <span className="dots" aria-hidden />}
        </span>
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
  // The checked_at each claim had when Check now was pressed. A check is finished when the row
  // carries a newer one, which is the only signal that separates "still looking" from "looked and
  // found nothing": both leave the claim pending.
  const [checkingFrom, setCheckingFrom] = useState<Record<string, string | null>>({});

  const isChecking = (c: Claim) => c.id in checkingFrom && checkingFrom[c.id] === c.checked_at;

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
    const watching = claims.some((c) => c.status === "pending") || claims.some(isChecking);
    if (!watching) return;
    const t = setInterval(() => void load(), claims.some(isChecking) ? 1500 : 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claims, load, checkingFrom]);

  // Once a row carries a newer check, the wait is over and the card stops animating.
  useEffect(() => {
    setCheckingFrom((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const c of claims) {
        if (c.id in next && next[c.id] !== c.checked_at) {
          delete next[c.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [claims]);

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

  async function act(id: string, path: string, then: string | null) {
    setBusy(true);
    setNote(null);
    try {
      await post(path, { id });
      if (then) setNote(then);
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
                This domain is eligible for active grading with this account. Others submitting this domain
                gets passive grading only. Click "Give it up" to remove this verification and stop active grading.
              </p>
              {/* The proofs stay visible once verified, both green. They are still load bearing:
                  every active grade re-reads them, so "is my record still there" has to be
                  answerable from here rather than only from a failed grade. */}
              <div className="proof-steps">
                <Factor label="The file" status={c.file_status} kind="file" checking={isChecking(c)}>
                  <p>
                    Served at <code>{c.origin}/.well-known/sloptic-verification.txt</code>. Leave it
                    there: an active grade re-checks it every time.
                  </p>
                </Factor>
                <Factor label="The DNS record" status={c.dns_status} kind="record" checking={isChecking(c)}>
                  <p>
                    Published at <code>_sloptic.{c.host}</code>. Leave it there too, for the same
                    reason.
                  </p>
                </Factor>
              </div>
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
                Publish the token below both as a file and as a DNS TXT record to prove ownership of
                this site.
              </p>
              {/* Once, and up here. It was inside both cards, which put the one thing a person came
                  to copy in two places and neither of them first. */}
              <pre className="token-block token-headline"><code>{c.token}</code></pre>

              {/* Shown in every state. A verified origin still depends on both of these, and
                  active grades re-check them each time, so hiding them once the claim goes green
                  would hide the only thing that says WHY it is green. */}
              <div className="proof-steps">
                <Factor label="The file" status={c.file_status} kind="file" checking={isChecking(c)}>
                  <p>
                    Serve it at <code>{c.origin}/.well-known/sloptic-verification.txt</code>, with the
                    token as the whole body.
                  </p>
                </Factor>
                <Factor label="The DNS record" status={c.dns_status} kind="record" checking={isChecking(c)}>
                  <p>
                    Add a TXT record at <code>_sloptic.{c.host}</code> with the same value. DNS can
                    take a while to propagate, which is normal.
                  </p>
                </Factor>
              </div>
              <div className="run-controls">
                <button className="button" type="button" disabled={busy || isChecking(c)}
                        onClick={() => {
                          setCheckingFrom((prev) => ({ ...prev, [c.id]: c.checked_at }));
                          void act(c.id, "/api/verify/recheck", null);
                        }}>
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
