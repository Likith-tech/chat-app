import React, { useState } from "react";
import { api } from "./api";

function Register({ switchToLogin, setUser }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      setError("Username, email and password are required.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await api.post("/register", {
        username,
        email,
        password,
      });

      const loginRes = await api.post("/login", {
        email,
        password,
      });

      if (!loginRes.data?.user || !loginRes.data?.token) {
        throw new Error("Auto login failed");
      }

      if (loginRes.data.token) {
        localStorage.setItem("token", loginRes.data.token);
      }

      sessionStorage.setItem("user", JSON.stringify(loginRes.data.user));
      setUser(loginRes.data.user);
    } catch (err) {
      setError(err?.response?.data?.message || "Registration failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-form">
      <label htmlFor="register-username">Username</label>
      <input
        id="register-username"
        placeholder="Choose username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <label htmlFor="register-email">Email</label>
      <input
        id="register-email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor="register-password">Password</label>
      <input
        id="register-password"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="auth-error">{error}</p>}

      <button onClick={handleRegister} disabled={loading}>
        {loading ? "Creating account..." : "Register"}
      </button>

      <p className="auth-switch">
        Already have an account?{" "}
        <button type="button" className="auth-link" onClick={switchToLogin}>
          Login
        </button>
      </p>
    </div>
  );
}

export default Register;
