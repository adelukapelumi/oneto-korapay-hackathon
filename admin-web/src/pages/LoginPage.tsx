import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { requestAdminOtp, verifyAdminOtp } from "../api";
import { useAuth } from "../auth";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle, type ThemeMode } from "../components/ThemeToggle";

export function LoginPage({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const { status, refreshSession } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") {
    return <Navigate to="/overview" replace />;
  }

  if (status === "checking") {
    return (
      <div className="auth-shell">
        <div className="panel status-screen">
          <p className="auth-eyebrow">Admin access only</p>
          <h1 className="page-title">Checking admin session</h1>
          <p className="supporting-text">
            Confirming whether this browser already has an active admin session.
          </p>
        </div>
      </div>
    );
  }

  const handleRequestOtp = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setIsLoading(true);
    try {
      await requestAdminOtp(email.trim());
      setOtpRequested(true);
      setMessage("If this email is an active admin account, an OTP has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request OTP.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.trim() || !code.trim()) {
      setError("Email and OTP code are required.");
      return;
    }

    setIsLoading(true);
    try {
      await verifyAdminOtp(email.trim(), code.trim());
      await refreshSession();
      navigate("/overview", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify OTP.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-layout">
        <section className="panel auth-brand-panel">
          <div className="auth-brand-copy">
            <div className="auth-brand-top">
              <span className="brand-badge">Production admin portal</span>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            </div>
            <div className="auth-logo-wrap">
              <BrandLogo theme={theme} className="auth-logo" alt="Oneto brand logo" />
            </div>
            <h1>Calm control for daily operations.</h1>
            <p>
              Review platform health, approve pending merchants, and handle merchant cashout review
              from one focused admin workspace.
            </p>

            <div className="auth-checklist">
              <div className="auth-checklist-item">
                <strong>Admin access only</strong>
                <span>This portal is reserved for approved oneto operators.</span>
              </div>
              <div className="auth-checklist-item">
                <strong>Enumeration-safe sign in</strong>
                <span>OTP messages do not reveal whether an email is an active admin account.</span>
              </div>
              <div className="auth-checklist-item">
                <strong>Production environment</strong>
                <span>Actions here affect the live admin workflow and should be reviewed carefully.</span>
              </div>
            </div>
          </div>

          <p className="auth-footnote">
            Use your approved admin email to request a one-time passcode. Do not share codes outside
            the admin team.
          </p>
        </section>

        <form className="panel auth-form-panel auth-form" onSubmit={otpRequested ? handleVerifyOtp : handleRequestOtp}>
          <div className="auth-header">
            <p className="auth-eyebrow">Oneto Admin</p>
            <h2>{otpRequested ? "Enter admin OTP" : "Sign in to continue"}</h2>
            <p>
              {otpRequested
                ? "Enter the one-time passcode sent to the admin email you provided."
                : "Request a one-time passcode to access the production admin workspace."}
            </p>
          </div>

          <div className="field-group">
            <label htmlFor="email">Admin email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@getoneto.com"
              autoComplete="email"
              disabled={isLoading}
            />
          </div>

          {otpRequested ? (
            <div className="field-group">
              <label htmlFor="code">OTP code</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                autoComplete="one-time-code"
                disabled={isLoading}
              />
            </div>
          ) : null}

          {message ? <p className="message">{message}</p> : null}
          {error ? <p className="error">{error}</p> : null}

          <div className="form-actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Please wait..." : otpRequested ? "Verify and continue" : "Send admin OTP"}
            </button>

            {otpRequested ? (
              <button
                type="button"
                className="secondary"
                disabled={isLoading}
                onClick={() => {
                  setOtpRequested(false);
                  setCode("");
                  setMessage(null);
                  setError(null);
                }}
              >
                Use a different email
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
