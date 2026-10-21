# Missing pages

Unknown page URLs use the root TanStack Router not-found boundary, including
extra path segments such as `/dashboard/missing` and `/privacy/missing`. They
retain HTTP 404, render without JavaScript and include noindex metadata. The
same public page is available to signed-out visitors, pending applicants and
signed-in staff. Auth guards still apply to real protected routes. Missing data,
permission denials, configuration failures and API JSON errors keep their
existing error handling; they are not converted into a missing-page screen.

The original implementation takes visual inspiration from the public
[React Bits Pro 404-5 preview](https://pro.reactbits.dev/docs/blocks/404/404-5).
No paid source or illustration assets are copied. The brown/cool-cream page
uses local fonts and Lucide icons: books, calendar attendance, a checklist,
graduation cap and people, retaining one cloud and two stars. Cards settle into
a scattered arrangement on entry and lift on hover. Animations finish within
two seconds; reduced motion disables them. All cards are decorative and hidden
from assistive technology. Navigation uses normal keyboard-accessible links.

Take me home returns to the public landing page. Open your workspace uses the
existing dashboard sign-in/verification flow. No arbitrary return URL, displayed
query string, new credentials or production records are introduced.

Validation: TypeScript, lint, build and the public/auth/staff browser suites.
The isolated browser checks cover HTTP/SSR 404, unknown/nested URLs, home/back
navigation, metadata cleanup, mobile overflow, cloud/star visibility and reduced
motion. Tests intercept remote APIs and use no production identities or writes.
