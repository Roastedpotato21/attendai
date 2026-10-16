import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout } from "@/components/policy/policy-layout";
import { POLICY_CONTACT_MESSAGE, POLICY_VERSION } from "@/lib/policies";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({ meta: [{ title: "Privacy Policy — AttendAI" }] }),
});

function PrivacyPage() {
  return (
    <PolicyLayout title="Privacy Policy" version={POLICY_VERSION}>
      <section>
        <h2>1. About this policy</h2>
        <p>
          AttendAI is an attendance management and guardian communication service for educational
          institutions. This policy explains how information is handled when institutions, staff,
          and guardians use AttendAI. An institution may also provide its own privacy notice for its
          use of student information.
        </p>
      </section>
      <section>
        <h2>2. Scope and information collected</h2>
        <p>
          We process institution and staff account details such as names, email addresses, roles,
          and account identifiers; student and guardian names and relationship details; guardian
          phone numbers or email addresses where entered; attendance records and corrections;
          communication preferences and consent; notification device registrations, Firebase Cloud
          Messaging identifiers, browser and device details; notification and delivery history; and
          security, audit, and diagnostic records.
        </p>
        <p>
          Information may come from institution staff, account holders, guardian device enrollment,
          and normal use of the service. We ask users to enter only information needed for
          authorized educational purposes.
        </p>
      </section>
      <section>
        <h2>3. How information is used</h2>
        <p>
          AttendAI uses this information to manage attendance, show authorized staff the current
          record, notify eligible guardians when enabled, administer accounts, enforce roles and
          institution boundaries, keep audit history, prevent duplicate or unauthorized
          notifications, and investigate security or delivery problems.
        </p>
      </section>
      <section>
        <h2>4. Service providers and sharing</h2>
        <p>
          Supabase supports authentication and application data storage. Firebase and Google Cloud
          process web push device identifiers and notification content needed for push delivery.
          Cloudflare may process requests and technical logs when it hosts or protects the
          application. Authorized institution users can access information according to their roles.
          We do not describe a provider's acceptance of a push request as proof that a guardian saw
          it.
        </p>
      </section>
      <section>
        <h2>5. Retention</h2>
        <p>
          Records are kept while needed to operate the service, meet an institution's recordkeeping
          needs, investigate incidents, or satisfy applicable obligations. Retention depends on the
          institution's settings and contractual requirements; AttendAI does not promise a single
          deletion period for all records. Device registrations may be deactivated while historical
          delivery and audit records remain. Ask your institution or AttendAI administrator for the
          applicable schedule.
        </p>
      </section>
      <section>
        <h2>6. Security</h2>
        <p>
          AttendAI uses HTTPS, authentication, role authorization, tenant isolation, database row
          level security, server side secrets, and audit records. Access is limited to people and
          systems that need it. No system can guarantee absolute security.
        </p>
      </section>
      <section>
        <h2>7. Student and guardian information</h2>
        <p>
          Institutions and their authorized staff manage student attendance under their relationship
          with students and guardians. AttendAI does not rely on a child directly accepting this
          policy. A guardian can enroll a browser device through a time limited invitation to
          receive eligible attendance notifications. The institution supplies the guardian and
          student relationships; the guardian chooses whether to enroll a device. Firebase and
          Google process the messaging registration information needed for delivery. Guardians can
          withdraw browser permission in device settings or disable the enrolled device. This
          enrollment does not create a guardian staff account. Browser permission, guardian
          notification consent, institution communication preferences, and staff policy acceptance
          are separate choices and records.
        </p>
      </section>
      <section>
        <h2>8. Requests and choices</h2>
        <p>
          Contact your institution administrator to request access to or correction of attendance
          and relationship information, deletion where applicable, or a change to optional guardian
          notification preferences. You can also disable browser notifications on your device.
          Requests may be subject to institutional records and legal requirements.
        </p>
      </section>
      <section>
        <h2>9. International processing</h2>
        <p>
          Service providers may process data in countries outside yours. The location and safeguards
          depend on the institution's service configuration and the providers' terms. Ask your
          institution administrator for details relevant to your deployment.
        </p>
      </section>
      <section>
        <h2>10. Changes and contact</h2>
        <p>
          We may publish an updated version and require staff to acknowledge it before continuing to
          use AttendAI. {POLICY_CONTACT_MESSAGE}
        </p>
      </section>
    </PolicyLayout>
  );
}
