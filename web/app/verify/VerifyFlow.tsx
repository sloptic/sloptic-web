"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

/** The row's one-line verdict, which is about the CLAIM rather than either proof. */
function claimLine(c: Claim): string {
  if (c.status === "verified") return "verified";
  if (c.status === "failed") return "gave up looking";
  if (c.status === "revoked") return "given up";
  if (!c.checked_at) return "waiting for the first check";
  if (c.file_status === "ok" && c.dns_status === "ok") return "verifying";
  return "waiting for both proofs";
}

/** A proof's state, small enough to sit in a row of them.
 *
 *  Same three readings the cards and the event slip use, so one glance down the list means the same
 *  thing everywhere: green holds, orange is yours to fix, grey is ours or not yet known.
 */
function Pill({ label, status, checking }: {
  label: string;
  status: Claim["file_status"];
  checking: boolean;
}) {
  return (
    <span className="proof-pill" data-state={status ?? "pending"}>
      {label}
      {checking && <span className="dots" aria-hidden />}
    </span>
  );
}

/** Copy the token, because it is 50 characters of base64 that has to land byte for byte in two
 *  places. Selecting it by hand is where a verification quietly fails. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button secondary copy-token"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access can be refused (an insecure origin, a permission policy). The token is
          // selectable in one click either way, so say nothing rather than claim a copy happened.
          setCopied(false);
        }
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

export default function VerifyFlow({ signedIn, initialClaims }: {
  signedIn: boolean;
  initialClaims: Claim[];
}) {
  const router = useRouter();
  const [claims, setClaims] = useState<Claim[]>(initialClaims);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The checked_at each claim had when Check now was pressed. A check is finished when the row
  // carries a newer one, which is the only signal that separates "still looking" from "looked and
  // found nothing": both leave the claim pending.
  const [checkingFrom, setCheckingFrom] = useState<Record<string, string | null>>({});
  // Open what needs doing. A pending claim is the one carrying instructions somebody is mid-way
  // through; a verified one is a row you glance at. So the list is quiet by default and loud exactly
  // where there is work, which is what keeps it readable at six domains and unchanged at one.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialClaims.filter((c) => c.status === "pending").map((c) => c.id))
  );

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

  /** Queue the full battery on an origin this account has proved it owns.
   *
   *  The server decides whether that is allowed, by re-reading the grant. This only asks, which is
   *  why it can be a plain button rather than a form carrying a claim about who the caller is.
   */
  async function gradeActively(origin: string) {
    setBusy(true);
    setNote(null);
    try {
      const d = await post("/api/grade", { url: origin, mode: "active" });
      router.push(`/grade/${d.id}`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not start the grade.");
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
        <details
          className="domain-row"
          key={c.id}
          open={expanded.has(c.id)}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setExpanded((prev) => {
              const next = new Set(prev);
              if (isOpen) next.add(c.id);
              else next.delete(c.id);
              return next;
            });
          }}
        >
          {/* The row is the whole state at a glance: which domain, and where each proof stands.
              Someone with six domains reads six lines instead of six pages of instructions, and
              opens only the one that needs them. */}
          <summary className="domain-summary">
            <span className="domain-name">{c.origin.replace(/^https?:\/\//, "")}</span>
            <span className="domain-proofs">
              <Pill label="file" status={c.file_status} checking={isChecking(c)} />
              <Pill label="dns" status={c.dns_status} checking={isChecking(c)} />
            </span>
            <span className="domain-verdict">{claimLine(c)}</span>
          </summary>

          <div className="domain-body">
            {c.status === "verified" ? (
              <p className="section-intro">
                Verified{c.verified_at ? ` on ${new Date(c.verified_at).toLocaleDateString()}` : ""}.
                This domain is eligible for active grading for this account only (others can only grade this)
                domain passively).
                {c.expires_at ? ` Prove it again by ${new Date(c.expires_at).toLocaleDateString()}.` : ""}
              </p>
            ) : c.status === "pending" ? (
              <p className="section-intro">
                Publish the token below both as a file and as a DNS TXT record to prove ownership of
                this site.
              </p>
            ) : (
              <p className="section-intro">
                This claim is {c.status}. Add the domain again above if you still want to verify it.
              </p>
            )}

            {c.status !== "revoked" && (
              <>
                <div className="token-row">
                  <pre className="token-block token-headline"><code>{c.token}</code></pre>
                  <CopyButton value={c.token} />
                </div>

                {/* Both proofs, in every state. They do not stop mattering once the claim is green:
                    every active grade re-reads them, so "is my record still there" has to be
                    answerable here rather than only from a grade that failed. */}
                <div className="proof-steps">
                  <Factor label="The file" status={c.file_status} kind="file" checking={isChecking(c)}>
                    <p>
                      Serve it at <code>{c.origin}/.well-known/sloptic-verification.txt</code>, with
                      the token as the whole body.
                    </p>
                  </Factor>
                  <Factor label="The DNS record" status={c.dns_status} kind="record" checking={isChecking(c)}>
                    <p>
                      Add a TXT record at <code>_sloptic.{c.host}</code> with the same value. DNS can
                      take a while to propagate, which is normal.
                    </p>
                  </Factor>
                </div>
              </>
            )}

            <div className="run-controls">
              {(c.status === "pending" || c.status === "verified") && (
                // Offered on a verified domain too: the proofs have to stay published, since every
                // active grade re-reads them, so "are they still there" needs an answer that does
                // not cost a failed grade.
                <button className={c.status === "verified" ? "button secondary" : "button"}
                        type="button" disabled={busy || isChecking(c)}
                        onClick={() => {
                          setCheckingFrom((prev) => ({ ...prev, [c.id]: c.checked_at }));
                          void act(c.id, "/api/verify/recheck", null);
                        }}>
                  {c.status === "verified" ? "Check again" : "Check now"}
                </button>
              )}
              {c.status === "verified" && (
                // Grades it, rather than pointing at the form and hoping. The origin is right here
                // and the account is the one holding the grant, so the button does the thing.
                <button className="button" type="button" disabled={busy}
                        onClick={() => void gradeActively(c.origin)}>
                  Grade it actively
                </button>
              )}
              {c.status !== "revoked" && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(
                      c.status === "verified"
                        ? `Give up verification for ${c.origin}? Active grading stops immediately. You can verify it again later.`
                        : `Stop trying to verify ${c.origin}? You can add it again later.`
                    )) return;
                    void act(c.id, "/api/verify/revoke", "Verification given up.");
                  }}
                >
                  Give it up
                </button>
              )}
            </div>

            {c.checked_at && (
              <p className="fineprint">
                Last checked {new Date(c.checked_at).toLocaleTimeString()}.
                {c.detail ? ` ${c.detail}` : ""}
              </p>
            )}
          </div>
        </details>
      ))}
    </>
  );
}
