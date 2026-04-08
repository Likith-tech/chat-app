import React, { useMemo, useState } from "react";
import Login from "./Login";
import Register from "./Register";
import Chat from "./Chat";
import "./App.css";

function App() {
  const [user, setUser] = useState(() => {
    try {
      const storedUser = sessionStorage.getItem("user");
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      return null;
    }
  });

  const [showLogin, setShowLogin] = useState(true);

  const authTitle = useMemo(
    () => (showLogin ? "Welcome back" : "Create your account"),
    [showLogin]
  );

  const handleAuthSuccess = (nextUser) => {
    setUser(nextUser);
    sessionStorage.setItem("user", JSON.stringify(nextUser));
  };

  const handleUserUpdate = (nextUser) => {
    setUser(nextUser);
    sessionStorage.setItem("user", JSON.stringify(nextUser));
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    sessionStorage.removeItem("user");
    setUser(null);
    setShowLogin(true);
  };

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-backdrop" />
        <div className="auth-card">
          <h1>{authTitle}</h1>
          <p className="auth-subtitle">
            Real-time chat, media sharing, and profile controls.
          </p>
          {showLogin ? (
            <Login
              setUser={handleAuthSuccess}
              switchToRegister={() => setShowLogin(false)}
            />
          ) : (
            <Register
              switchToLogin={() => setShowLogin(true)}
              setUser={handleAuthSuccess}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <Chat user={user} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
  );
}

export default App;
