# Signup email code verification

Signup supports the existing confirmation link and a numeric email-code option.
After account creation, **Check your email** shows Code Slots and the registration
email. `/institution-verification` also offers code entry to signed-out applicants,
so a reload does not require another signup. No code is persisted in localStorage,
sessionStorage, URLs, application logs or audit records.

The browser calls Supabase Auth `verifyOtp` with email, token and `type: email`.
Only a successful confirmed account/session response for the requested email shows
success. Institution verification, independent review and staff membership gates
remain in place. Code entry never calls a provisioning RPC or grants a tenant role.
Link confirmation, invitation acceptance and password recovery remain available.

Invalid/expired/used codes show a generic error and drain the slots. A failed
network request never shows success. Full entry enables an explicit Verify action;
typing the last digit does not send a request. Resend uses the existing signup
confirmation endpoint, with an in-flight guard and a 60-second local cooldown.
Supabase remains responsible for rate limits, expiry and single-use validation;
the local cooldown is only a UI aid. A resend success reports a request, not
delivery. It does not enumerate registered users or create a magic-link account.

## Supabase configuration still required

The app change does not edit a hosted project's email templates or send test mail.
To offer actual codes, install [confirmation.html](../supabase/templates/confirmation.html)
as **Authentication → Email Templates → Confirm signup**. Keep both the `Token`
and `ConfirmationURL` template variables. Keep email confirmation enabled and
the deployed `/institution-verification` URL in the Auth redirect allowlist.

Supabase's [email template documentation](https://supabase.com/docs/guides/auth/auth-email-templates)
describes both variables; its [verifyOtp API](https://supabase.com/docs/reference/javascript/auth-verifyotp)
documents verification. If the existing email contains only a link, that link
continues to work, but users cannot enter a code until the template includes it.

`VITE_EMAIL_OTP_LENGTH` defaults to 6 and accepts 6–10. Set it to the project's
actual email OTP length and rebuild. A bad configuration fails explicitly. This
is public format configuration, not a credential. No OTP expiry or delivery time
is invented in the UI or template. Validate a real signup on staging after the
template/redirect settings are applied.

## Component provenance and theme

The actual [React Bits Code Slots](https://reactbits.dev/micro/code-slots)
[TypeScript source](https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Micro/CodeSlots)
is adapted with its digit springs, cascade, moving caret, paste/autofill receiver,
error drain and success wash. Motion is its runtime animation dependency; the
source's Hugeicons checkmark is replaced with the existing Lucide icon. Brown,
cool cream, local font and smaller radii match AttendAI. Slot size follows available
form width, including configurations with longer codes. Reduced motion uses the
source's static alternatives. Invitation/password and institution verification
pages also use the shared account theme.

The [upstream license](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)
permits inclusion in an application and restricts redistribution of the components
as a standalone product. Its complete notice is retained at
`src/components/auth/code-slots/LICENSE.md`. Do not extract/sell this component as
a component pack.

## Checks

    npm run build
    npx tsc --noEmit
    npm run lint
    node scripts/test-auth-browser.mjs http://127.0.0.1:4195 9339

Browser checks use an isolated local preview and intercepted Supabase responses.
They cover registration, pasted digits, incomplete input, expired-code feedback,
clearing, resend/cooldown, reload, successful API verification and the subsequent
pending-institution gate. Existing auth/academic/invitation fixtures remain in the
regression run. They create no real users, send no email/SMS and do not prove live
delivery or a hosted email template is configured.
