# Compact staff profile badge

The staff dashboard and `/staff-profile` show a compact 190 CSS pixel lanyard at
the right of the personal greeting, approximately 5 cm in CSS units. Physical size
depends on screen density and zoom. Owner, Faculty, Class Incharge, HOD,
Coordinator and other staff use the same real profile name/designation. No role
or badge is inferred from the photo. Existing role and membership checks remain.

**Add photo / Change photo** opens the private photo editor. Select a PNG/JPEG up
to 4 MiB, review the portrait preview, then save. The browser decodes and redraws the
image to strip original file metadata, crops it to 384 × 512 and bounds the saved
JPEG to 128 KiB. Inputs over 20 megapixels or 8192 pixels per side fail explicitly.
Save is an actual Supabase mutation; failed saves show an error and retain the
previous saved image. Removing a photo deletes the saved bytes. The header avatar
and lanyard read the same query and refresh together. Clicking the header avatar
opens the staff profile. Each active institution workspace owns its photo.

Without a photo, initials appear; the reference creator's portrait is never
presented as a staff member. The accessible badge
label uses the real name/designation. It is a display photo, not an
identity credential, institution verification evidence or biometric feature.

## Source and animation

The actual [React Bits Lanyard](https://reactbits.dev/components/lanyard) source
from [David Haz's public repository](https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Components/Lanyard)
is adapted. It retains Three.js rendering, woven strap, metal clip, glossy card,
rope/body simulation, drag/swing and click-to-flip behavior. The source is emitted
as JavaScript with a typed public declaration instead of relaxing the app's
stricter indexed-access settings. Its full MIT + Commons Clause notice is included
in `src/components/profile/lanyard/LICENSE.md`. Reuse is inside this application,
not as a standalone component product.

At the user's explicit direction, the badge preserves the reference's own look:
plain black woven strap, white rounded glossy card, silver clip/ring, original
geometry, size fraction, strap length and motion settings. Only its container is
compact. The face follows the supplied screenshot's layout: small real profile
name at the top right and the large uploaded portrait below. No React logo,
creator handle, reference portrait, brown tint, cream card or branded ID layout
is used. No reference artwork assets are shipped.
Three.js is loaded lazily only in the signed-in badge. The upstream implementation
pauses offscreen, uses visibility handling, stops when resting and disposes its
renderer, textures, materials and geometry. Device pixel ratio is capped at 1.5
for this small canvas. Keyboard users can use the separate Flip badge control.
Reduced motion uses a static card with the actual photo and no WebGL renderer.
If WebGL is unavailable, the static badge remains. Photo editing is independent
of animation support.

## Private persistence and rollout

Apply all earlier migrations, then additive migration
`00049_staff_profile_photos.sql`, before deploying the UI. No production migration
is applied by the local checks. Never reset a linked database.

`staff_profile_photos` uses one row per profile/institution, with bounded PNG/JPEG
bytes, revision and timestamp. Database RPCs derive the profile from the verified
caller, validate current workspace access and policy acceptance, check byte
length/signature and serialize saves with institution lifecycle changes. They do
not accept another person's profile ID. Browser table reads/writes have no RLS
policies; even the owner uses the self-only RPC. No public URLs or storage bucket
are involved. Audit records describe format/size/action, never photo bytes.

The signature check is not a general image malware scanner. The normal app upload
path decodes and re-encodes images; photos are shown only to their own staff
identity. Removing an image deletes the canonical row, and previously downloaded
copies remain subject to normal browser memory/cache lifetimes. Missing schema or
denied access produces an explicit photo error; there is no local persistence
fallback. No Auth metadata, permissions or historical verification photo is edited.

## Validation

The full disposable PostgreSQL migration/regression suite includes
`supabase/tests/database/49_staff_profile_photos.sql`: persistence/replacement,
removal, tenant/self privacy, direct-read/delete bypass denial, invalid signature,
oversize payload, revoked membership and audit-byte exclusion.

The isolated staff browser suite exercises the real editor with synthetic image
bytes, save/avatar refresh, reload, removal, mobile sizing and reduced motion.
These fixtures intercept Supabase calls and do not upload production images.
Run build, TypeScript and lint plus the existing auth/staff/student/period browser
checks. Validate a real upload in staging after applying the migration.
