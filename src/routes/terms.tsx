import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout } from "@/components/policy/policy-layout";
import { POLICY_CONTACT_MESSAGE, POLICY_VERSION } from "@/lib/policies";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({ meta: [{ title: "Terms & Conditions — AttendAI" }] }),
});

function TermsPage() {
  return (
    <PolicyLayout title="Terms & Conditions" version={POLICY_VERSION}>
      <section>
        <h2>1. Acceptance and eligibility</h2>
        <p>
          By creating or using a staff account, you agree to these terms. Accounts are for people
          authorized by an educational institution to carry out its work. If you act for an
          institution, you must have authority to use AttendAI for that institution.
        </p>
      </section>
      <section>
        <h2>2. Accounts and authorized use</h2>
        <p>
          Keep your credentials private, use a strong password, and report suspected unauthorized
          access to your institution administrator. Use AttendAI only for legitimate attendance and
          related institutional work. Do not access another institution's data, impersonate anyone,
          submit misleading records, probe security controls, or use the service for unsolicited
          communications.
        </p>
      </section>
      <section>
        <h2>3. Attendance information</h2>
        <p>
          Authorized staff are responsible for entering and correcting attendance accurately.
          AttendAI may preserve an audit trail of changes. Review current attendance before acting
          on a notification; a record may have been corrected after the notification was sent.
        </p>
      </section>
      <section>
        <h2>4. Notifications</h2>
        <p>
          Web push delivery depends on browser and device support, notification permission, internet
          connectivity, and third party push infrastructure. A provider accepting a message does not
          guarantee that it reached the device or was read. Notifications may be delayed, expire, or
          fail. Do not rely on push as the only way to confirm a student's status.
        </p>
      </section>
      <section>
        <h2>5. Availability and third parties</h2>
        <p>
          We work to keep AttendAI available but maintenance, network problems, and provider
          failures may interrupt access. Supabase, Firebase and Google Cloud, and Cloudflare may
          support parts of the service under their own terms. Features and integrations can change
          as the service develops.
        </p>
      </section>
      <section>
        <h2>6. Intellectual property</h2>
        <p>
          AttendAI and its software, branding, and documentation belong to their respective owners.
          Institutions retain rights in the data they provide, subject to their agreements and
          applicable law. These terms grant only the access needed for authorized use of the
          service.
        </p>
      </section>
      <section>
        <h2>7. Suspension and termination</h2>
        <p>
          Access may be suspended or ended for security, misuse, loss of institutional
          authorization, or service closure. Institutions remain responsible for their recordkeeping
          and export needs under their applicable agreements.
        </p>
      </section>
      <section>
        <h2>8. Responsibility and limitations</h2>
        <p>
          AttendAI is a support tool for attendance workflows. To the extent permitted by applicable
          law and the institution's agreement, responsibility for losses arising from service use is
          limited by that agreement. This section does not remove rights that cannot lawfully be
          excluded.
        </p>
      </section>
      <section>
        <h2>9. Changes, law, and contact</h2>
        <p>
          We may update these terms and ask staff to accept a new version before further use.
          Governing law and any dispute process should be set in the institution's signed agreement;
          this application does not currently define one. {POLICY_CONTACT_MESSAGE}
        </p>
      </section>
    </PolicyLayout>
  );
}
