import React, { useEffect, useMemo, useState } from "react";

function ProfilePage({
  user,
  profileData,
  onBack,
  onSave,
  onUploadPhoto,
  onLogout,
  apiBase,
}) {
  const [form, setForm] = useState(profileData);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(profileData);
  }, [profileData]);

  const photoUrl = useMemo(() => {
    if (!form.profilePic) return null;
    return `${apiBase}/${form.profilePic}`;
  }, [apiBase, form.profilePic]);

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      const saved = await onSave(form);
      setForm(saved);
    } catch {
      setError("Could not save profile settings");
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");

    try {
      const updated = await onUploadPhoto(file);
      setForm(updated);
    } catch {
      setError("Could not upload profile photo");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  return (
    <div className="profile-page">
      <header className="profile-header">
        <button className="ghost-btn" onClick={onBack}>
          Back to Chat
        </button>
        <h2>Profile & Settings</h2>
        <button className="send-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </header>

      {error && <p className="auth-error profile-error">{error}</p>}

      <section className="profile-grid">
        <article className="profile-card">
          <h3>Profile Details</h3>

          <div className="profile-photo-block">
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" className="profile-photo-preview" />
            ) : (
              <div className="profile-photo-fallback">
                {(form.displayName || user.username).slice(0, 1).toUpperCase()}
              </div>
            )}

            <label className="upload-btn">
              {uploading ? "Uploading..." : "Upload Photo"}
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={handlePhotoUpload}
              />
            </label>
          </div>

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

