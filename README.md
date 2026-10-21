# AttendAI

Production communication scheduling is documented in
[`docs/phase-4a-communication-scheduler.md`](docs/phase-4a-communication-scheduler.md).

AttendAI is an automated attendance tracking and multilingual AI communication platform built for schools and colleges.

## Development

You need Node.js and npm.

```sh
npm i
npm run dev
```

Supabase is required; configure the browser values in `.env.example`. Demo
sign-in and automatic sample data are not supported. Production cleanup
findings and the read-only database audit are documented in
[`docs/production-data-cleanup.md`](docs/production-data-cleanup.md).

Institution registration requires independent existence and representative
authority review. The workflow, additive migrations and production setup are in
[`docs/institution-verification.md`](docs/institution-verification.md).

Institution profiles, academic structure, staff roles, scoped responsibilities
and private invitation links are documented in
[`docs/institution-setup-phase2a.md`](docs/institution-setup-phase2a.md).

Ownership transfer, staff leave/deactivation, responsibility handover and reviewed
emergency succession are documented in
[`docs/institution-setup-phase2b.md`](docs/institution-setup-phase2b.md).

Student CSV/Excel import, cohorts, placement history, promotion and academic
status changes are documented in
[`docs/student-academics-phase3a.md`](docs/student-academics-phase3a.md).

Guardian identities, dated student relationships, private contact management,
import integration and separate notification preferences/consent are documented in
[`docs/guardian-mapping-phase3b.md`](docs/guardian-mapping-phase3b.md).

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Supabase
- Twilio
