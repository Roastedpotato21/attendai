import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/db/connection";
import { normalizeAuthEmail } from "@/lib/auth-errors";
import CodeSlots, { type CodeSlotsStatus } from "./code-slots/code-slots";

export function emailCodeLength() {
  const raw = import.meta.env["VITE_EMAIL_OTP_LENGTH"] ?? "6";
  if (!/^(6|7|8|9|10)$/.test(raw))
    throw new Error("VITE_EMAIL_OTP_LENGTH must match Supabase's email OTP length (6–10).");
  return Number(raw);
}

/** Uses real Supabase Auth verification; it never grants tenant membership. */
export function EmailCodeVerification({ initialEmail = "" }: { initialEmail?: string }) {
  const length = emailCodeLength();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CodeSlotsStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [size, setSize] = useState(36);
  const ref = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!resendAt) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize(
        Math.max(18, Math.min(44, Math.floor((element.clientWidth - (length - 1) * 6) / length))),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [length]);
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || code.length !== length || status === "success") return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const normalized = normalizeAuthEmail(email);
      const { data, error: reason } = await supabase.auth.verifyOtp({
        email: normalized,
        token: code,
        type: "email",
      });
      if (
        reason ||
        !data.session ||
        !data.user?.email_confirmed_at ||
        normalizeAuthEmail(data.user.email ?? "") !== normalized
      ) {
        setStatus("error");
        setError(
          reason?.status === 429
            ? "Too many attempts. Wait before trying again."
            : "This code could not be verified. It may be invalid, expired or already used. Check the email or request a new one.",
        );
        return;
      }
      setCode("");
      setStatus("success");
      setMessage("Email verified. Your institution still requires independent review.");
    } catch {
      setError("Verification is unavailable right now. Check your connection and try again.");
      setStatus("error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function resend() {
    if (inFlight.current || Date.now() < resendAt || status === "success") return;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the email address used for registration.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setResendAt(Date.now() + 60_000);
    try {
      const { error: reason } = await supabase.auth.resend({
        type: "signup",
        email: normalizeAuthEmail(email),
        options: { emailRedirectTo: new URL("/institution-verification", location.origin).href },
      });
      if (reason) {
        setError(
          "A new verification email could not be requested. Wait a minute and try again, or use the existing email link.",
        );
        return;
      }
      setCode("");
      setStatus("idle");
      setMessage(
        "If this address has an eligible pending account, a new verification email has been requested. Check your inbox and spam folder.",
      );
    } catch {
      setError("The verification request failed. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="aw-email-code" ref={ref}>
      <form onSubmit={verify} className="space-y-4" aria-label="Verify account email with a code">
        <div>
          <Label htmlFor="verification-email">Registration email</Label>
          <Input
            id="verification-email"
            type="email"
            autoComplete="email"
            value={email}
            required
            disabled={busy || status === "success"}
            onChange={(event) => {
              setEmail(event.target.value);
              setCode("");
              setError("");
              setStatus("idle");
            }}
          />
        </div>
        <div>
          <Label htmlFor="email-verification-code">Email verification code</Label>
          <p id="email-code-help" className="aw-auth-reset">
            Enter the {length}-digit code from your registration email. You can also use the email's
            verification link.
          </p>
          <CodeSlots
            id="email-verification-code"
            describedBy="email-code-help email-code-feedback"
            length={length}
            value={code}
            onChange={(value) => {
              setCode(value);
              if (value && status === "error") {
                setStatus("idle");
                setError("");
              }
            }}
            status={status}
            disabled={busy}
            slotSize={size}
            gap={6}
            ariaLabel="Email verification code"
          />
        </div>
        <div id="email-code-feedback" aria-live="polite">
          {error && (
            <p role="alert" className="aw-auth-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="aw-auth-reset">
              {message}
            </p>
          )}
        </div>
        {status === "success" ? (
          <Button asChild className="aw-auth-submit">
            <a href="/institution-verification">Continue institution verification</a>
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              className="aw-auth-submit"
              disabled={busy || code.length !== length}
            >
              {busy ? "Please wait…" : "Verify email code"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy || remaining > 0}
              onClick={() => void resend()}
            >
              {remaining > 0
                ? `Request another email in ${remaining}s`
                : "Request another verification email"}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
