import React, { useState } from "react";
import Login from "./Login";
import Register from "./Register";
import Chat from "./Chat";

function App() {
  // ✅ Safe user loading (no JSON error)
  const [user, setUser] = useState(() => {
    try {
      const storedUser = sessionStorage.getItem("user")
      return storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
      return null;
    }
  });

  const [showLogin, setShowLogin] = useState(true);

  // 🔐 If NOT logged in
  if (!user) {
    return showLogin ? (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <Login setUser={setUser} />

        <p>
          Don't have an account?{" "}
          <button onClick={() => setShowLogin(false)}>Register</button>
        </p>
      </div>
    ) : (
      <div style={{ textAlign: "center", marginTop: "50px" }}>
        <Register switchToLogin={() => setShowLogin(true)} />

        <p>
          Already have an account?{" "}
          <button onClick={() => setShowLogin(true)}>Login</button>
        </p>
      </div>
    );
  }

  // 💬 If logged in → show chat
  return <Chat user={user} />;
}

export default App;