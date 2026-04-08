import React, { useEffect, useState } from "react";

function ProfilePage({ user, profileData, onBack, onSave, onLogout }) {
  const [form, setForm] = useState(profileData);

  useEffect(() => {
    setForm(profileData);
  }, [profileData]);

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="profile-page">
      <header className="profile-header">
        <button className="ghost-btn" onClick={onBack}>
          Back to Chat
        </button>
        <h2>Profile & Settings</h2>
        <button className="send-btn" onClick={() => onSave(form)}>
          Save
        </button>
      </header>

      <section className="profile-grid">
        <article className="profile-card">
          <h3>Profile Details</h3>

          <label htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            value={form.displayName}
            onChange={(e) => update("displayName", e.target.value)}
          />

          <label htmlFor="about">About</label>
          <input
            id="about"
            value={form.about}
            onChange={(e) => update("about", e.target.value)}
          />

          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            placeholder="Optional"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
          />

          <label htmlFor="email">Email</label>
          <input id="email" value={user.email || "-"} disabled />

          <label htmlFor="accent">Accent color</label>
          <input
            id="accent"
            type="color"
            value={form.accent}
            onChange={(e) => update("accent", e.target.value)}
          />
        </article>

        <article className="profile-card">
          <h3>Settings</h3>

          <div className="switch-row">
            <span>Notifications</span>
            <input
              type="checkbox"
              checked={form.notifications}
              onChange={(e) => update("notifications", e.target.checked)}
            />
          </div>

          <div className="switch-row">
            <span>Read receipts</span>
            <input
              type="checkbox"
              checked={form.readReceipts}
              onChange={(e) => update("readReceipts", e.target.checked)}
            />
          </div>

          <div className="switch-row">
            <span>Compact chat mode</span>
            <input
              type="checkbox"
              checked={form.compactMode}
              onChange={(e) => update("compactMode", e.target.checked)}
            />
          </div>

          <label htmlFor="privacy">Status privacy</label>
          <select
            id="privacy"
            value={form.statusPrivacy}
            onChange={(e) => update("statusPrivacy", e.target.value)}
          >
            <option value="everyone">Everyone</option>
            <option value="contacts">My contacts</option>
            <option value="nobody">Nobody</option>
          </select>

          <div className="settings-note">
            <p>Security</p>
            <p>Use a strong password and log out on shared devices.</p>
          </div>

          <button className="danger-btn" onClick={onLogout}>
            Logout
          </button>
        </article>
      </section>
    </div>
  );
}

export default ProfilePage;
