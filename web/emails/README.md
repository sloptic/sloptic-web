# Email templates

Supabase Auth's email templates are edited in the dashboard (Authentication -> Email Templates),
which means they exist in exactly one place, have no history, and change without a diff. These files
are the source of truth: edit here, then paste into the dashboard.

| File | Dashboard template | Who receives it |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | a first-time address |
| `magic-link.html` | Magic Link | an address that already has an account |

`signInWithOtp` is the only email-sending auth path the site uses
(`app/signin/SignInForm.tsx`), but it sends **one of two templates** depending on whether the
address already has an account. Both have to be styled, and Confirm signup matters more: it is what
every first-time visitor sees, which at launch is everyone. The remaining templates (recovery,
email change, invite) are left at Supabase's defaults because nothing here triggers them.

The two differ only where the facts differ. A first-time reader is confirming an address rather
than returning, and the reassurance for a wrong recipient is stronger on the signup side: no
account has been made, rather than nothing has happened. The link carries `type=signup` instead of
`type=magiclink`, which `app/auth/confirm/route.ts` accepts as one of its known types.

## Why they look like 2005

Mail clients are not browsers. Tables rather than flex or grid, because Outlook renders neither.
Inline styles rather than a stylesheet, because Gmail strips `<style>` unevenly. No images, because
clients block remote images by default and a sign-in mail is read on first open or not at all.

## Subject lines

Set in the dashboard beside each template, not in these files.

- Confirm signup: `Confirm your Sloptic account`
- Magic Link: `Your Sloptic sign-in link`

## The link points at sloptic.org, not at Supabase

`{{ .ConfirmationURL }}` resolves to the project's API host, so the magic link read
`https://<project-ref>.supabase.co/auth/v1/verify?token=...`: a random string on a domain the
reader has never seen, in a mail asking them to click it. That is the shape of a phishing mail, and
no wording fixes it, because "this link is safe" is what an attacker writes too.

So the template builds the link from `{{ .RedirectTo }}` instead, and `app/auth/confirm/route.ts`
redeems the token hash. `RedirectTo` is the `/auth/confirm?next=...` URL the sign-in form asked for,
and it always carries a query string, so appending `&token_hash=` stays valid.

Two things this depends on:

- **`/auth/confirm` must be listed under Supabase's allowed redirect URLs.** If it is not, Supabase
  substitutes the Site URL and the appended token hash lands on the wrong path.
- **OAuth still lands on `/auth/callback`.** That flow returns a `code` to exchange, not a token
  hash, so the two are separate routes. Both call `mirrorProfile`, which is the only reason they
  cannot drift on `terms_accepted_at`, the column the active tier rests on.

## Sending

These go out through custom SMTP (ZeptoMail), not Supabase's built-in sender, which is capped at
2 messages an hour and carries no delivery guarantee. With magic-link sign-in that cap is the front
door: the third person to sign in during any hour gets nothing at all.

Both senders on this domain (Zoho Mail for the `hello@` mailbox, ZeptoMail for these) have to appear
in ONE SPF record. A second TXT record beginning `v=spf1` does not add a sender, it makes SPF fail
for both.
