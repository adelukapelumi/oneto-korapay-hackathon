import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { requestAdminOtp, verifyAdminOtp } from "../api";
import { useAuth } from "../auth";

export function LoginPage() {
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
    return <p>Checking admin session...</p>;
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
      <form className="panel" onSubmit={otpRequested ? handleVerifyOtp : handleRequestOtp}>
        <h1>oneto Admin Login</h1>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@getoneto.com"
          autoComplete="email"
          disabled={isLoading}
        />

        {otpRequested ? (
          <>
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
          </>
        ) : null}

        {message ? <p className="message">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={isLoading}>
          {isLoading
            ? "Please wait..."
            : otpRequested
              ? "Verify admin OTP"
              : "Request admin OTP"}
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
      </form>
    </div>
  );
}
