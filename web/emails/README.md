# Email templates

Supabase Auth's email templates are edited in the dashboard (Authentication -> Email Templates),
which means they exist in exactly one place, have no history, and change without a diff. These files
are the source of truth: edit here, then paste into the dashboard.

| File | Dashboard template |
| --- | --- |
| `magic-link.html` | Magic Link |

`signInWithOtp` is the only email-sending auth path the site uses (`app/signin/SignInForm.tsx`), so
Magic Link is the only template that matters today. The others are left at Supabase's defaults
because nothing triggers them.

## Why they look like 2005

Mail clients are not browsers. Tables rather than flex or grid, because Outlook renders neither.
Inline styles rather than a stylesheet, because Gmail strips `<style>` unevenly. No images, because
clients block remote images by default and a sign-in mail is read on first open or not at all.

## Subject lines

Set in the dashboard beside each template, not in these files.

- Magic Link: `Your Sloptic sign-in link`

## Sending

These go out through custom SMTP (ZeptoMail), not Supabase's built-in sender, which is capped at
2 messages an hour and carries no delivery guarantee. With magic-link sign-in that cap is the front
door: the third person to sign in during any hour gets nothing at all.

Both senders on this domain (Zoho Mail for the `hello@` mailbox, ZeptoMail for these) have to appear
in ONE SPF record. A second TXT record beginning `v=spf1` does not add a sender, it makes SPF fail
for both.
