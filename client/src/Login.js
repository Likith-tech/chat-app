import React, { useState } from "react";
import { api } from "./api";

function Login({ setUser, switchToRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api.post("/login", {
        email,
        password,
      });

      if (!res.data?.user || !res.data?.token) {
        throw new Error("Invalid login response");
      }

      if (res.data.token) {
        localStorage.setItem("token", res.data.token);
      }
      sessionStorage.setItem("user", JSON.stringify(res.data.user));

      setUser(res.data.user);
    } catch (err) {
      setError(err?.response?.data?.message || "Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-form">
      <label htmlFor="login-email">Email</label>
      <input
        id="login-email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="login-password">Password</label>
      <input
        id="login-password"
        type="password"
        placeholder="Enter your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="auth-error">{error}</p>}

      <button onClick={handleLogin} disabled={loading}>
        {loading ? "Signing in..." : "Login"}
      </button>

      <p className="auth-switch">
        Need an account?{" "}
        <button type="button" className="auth-link" onClick={switchToRegister}>
          Register
        </button>
      </p>
    </div>
  );
}

export default Login;
