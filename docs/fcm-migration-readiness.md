# Guardian FCM migration readiness

Historical readiness record for the original `siri-1b57c` integration. The
current project replacement and its remaining gates are recorded in
`fcm-project-replacement.md`.

The Firebase project `siri-1b57c` (project number `1084661061876`) and Web app
`attendai-web` (`1:1084661061876:web:1259951038ec78dc75e6a1`) were confirmed
active through the Firebase integration. Supabase remains the database and staff
authentication provider. No Firebase project or app was created.

New absences enqueue `push` communications and jobs through migrations `00013`
and `00014`. Historical SMS rows and the Twilio callback remain unchanged. The
legacy claim function cannot claim push jobs. The push worker checks the current
attendance, tenant, guardian relationship, consent, installation, lease, and rate
limit before each FCM call. Device attempts are tracked independently. An FCM
response is recorded as `provider_accepted`, never `delivered`.

Staff create a one-use, 15-minute invitation from Guardian devices. The link
contains a high-entropy token in the URL fragment; only its SHA-256 hash is
stored. A guardian grants browser notification permission through a click, then
the server binds the Firebase installation ID to that guardian and issues a
secure, HTTP-only device cookie. The page can refresh or revoke the device.
Device IDs and cookies are inaccessible to ordinary Supabase clients.

If browser notification permission is removed, the device is revoked and the
receiver directs the guardian to request a new invitation. It only reports
notifications enabled after registration and server enrollment/refresh succeed.

Configuration required before a controlled test:

1. In Firebase Console, verify Cloud Messaging is available and the FCM API is
   enabled for `siri-1b57c`. Confirm or create a Web Push public key under
   Project settings → Cloud Messaging → Web configuration, then set only the
   **public** key as `VITE_FIREBASE_VAPID_KEY` in the deployment environment.
2. Provide trusted-server Firebase Admin authentication for the same project.
   Prefer Application Default Credentials in the runtime. Alternatively provide
   `FIREBASE_SERVICE_ACCOUNT_JSON` as a server-only secret. Never place it in a
   `VITE_*` variable or commit the JSON file. The Firebase CLI login is not an
   Admin SDK credential.
3. Set `ATTENDAI_APP_URL` to the HTTPS application origin, apply the additive
   Supabase migrations, and deploy the same public Firebase Web config used by
   the receiver and its service worker. The service worker is emitted as a
   versioned asset by the Vite build and passed explicitly to Firebase
   Messaging registration.
4. Enroll one designated guardian browser, grant permission, and verify that
   its installation is active for the correct tenant and guardian. Confirm
   `communication_consent` and `receives_notifications` independently.
5. Perform Firebase Admin dry-run validation against that registered
   installation before changing `FCM_DELIVERY_MODE`. A dry-run can validate
   the server request but cannot prove browser delivery. A subsequent real
   push requires separate authorization and exactly one controlled test.

Current local configuration has `NOTIFICATION_PROVIDER=fcm`,
`SMS_DELIVERY_MODE=disabled`, and `FCM_DELIVERY_MODE=disabled`. Local Admin
authentication and a Web Push public key are unavailable, so no FCM dry-run or
real push was attempted. The Firebase integration exposes no read-only Web Push
key or FCM API status inspection operation; these console checks remain open.

Validation completed locally: 25 communication tests, disposable PostgreSQL
migrations and behavior tests, TypeScript, ESLint, production build, and
`git diff --check`. No remote Supabase migration or application deploy was
performed.
