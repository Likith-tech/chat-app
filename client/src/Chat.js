import React, { useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import axios from "axios";
import ProfilePage from "./ProfilePage";
import "./Chat.css";

const API_BASE = "https://chat-app-98qi.onrender.com";
const socket = io(API_BASE);

const TABS = [
  { id: "chats", label: "Chats" },
  { id: "status", label: "Status" },
  { id: "calls", label: "Calls" },
];

const defaultProfile = {
  displayName: "",
  about: "Available",
  phone: "",
  accent: "#0f766e",
  notifications: true,
  readReceipts: true,
  compactMode: false,
  statusPrivacy: "contacts",
};

function Chat({ user, onLogout, onUserUpdate }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [lastMessages, setLastMessages] = useState({});

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [contacts, setContacts] = useState([]);

  const [activeTab, setActiveTab] = useState("chats");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const [profileData, setProfileData] = useState(defaultProfile);

  const chatRef = useRef(null);
  const profileStorageKey = useMemo(
    () => `chat_profile_${user.username}`,
    [user.username]
  );

  useEffect(() => {
    const savedProfile = localStorage.getItem(profileStorageKey);
    const parsed = savedProfile ? JSON.parse(savedProfile) : {};

    setProfileData({
      ...defaultProfile,
      ...parsed,
      displayName: parsed.displayName || user.username,
    });
  }, [profileStorageKey, user.username]);

  useEffect(() => {
    if (user) {
      socket.emit("join", user);
    }
  }, [user]);

  useEffect(() => {
    const handleOnlineUsers = (users) => setOnlineUsers(users);

    const handleTyping = (username) => {
      if (username === selectedUser?.username) {
        setTypingUser(username);
      }
    };

    const handleStopTyping = () => setTypingUser("");

    const handleReceiveMessage = (data) => {
      const otherUser =
        data.sender === user.username ? data.receiver : data.sender;

      setLastMessages((prev) => ({
        ...prev,
        [otherUser]: data.message,
      }));

      setContacts((prev) => {
        const alreadyExists = prev.some((c) => c.contact === otherUser);
        return alreadyExists ? prev : [...prev, { contact: otherUser }];
      });

      if (!selectedUser) return;

      const isRelevant =
        (data.sender === user.username &&
          data.receiver === selectedUser.username) ||
        (data.sender === selectedUser.username &&
          data.receiver === user.username);

      if (isRelevant) {
        setMessages((prev) => [...prev, data]);
      }
    };

    socket.on("onlineUsers", handleOnlineUsers);
    socket.on("typing", handleTyping);
    socket.on("stopTyping", handleStopTyping);
    socket.on("receiveMessage", handleReceiveMessage);

    return () => {
      socket.off("onlineUsers", handleOnlineUsers);
      socket.off("typing", handleTyping);
      socket.off("stopTyping", handleStopTyping);
      socket.off("receiveMessage", handleReceiveMessage);
    };
  }, [selectedUser, user.username]);

  useEffect(() => {
    if (!selectedUser) {
      setMessages([]);
      return;
    }

<<<<<<< HEAD
    axios
      .get(
        `https://chat-app-98qi.onrender.com/messages/${user.username}/${selectedUser.username}`
      )
      .then((res) => setMessages(res.data));
=======
    setLoadingMessages(true);
>>>>>>> 170b423 (your message)

    axios
      .get(`${API_BASE}/messages/${user.username}/${selectedUser.username}`)
      .then((res) => setMessages(res.data))
      .finally(() => setLoadingMessages(false));
  }, [selectedUser, user.username]);

  useEffect(() => {
    axios.get(`${API_BASE}/last-messages/${user.username}`).then((res) => {
      const map = {};

<<<<<<< HEAD
    axios
      .get(`https://chat-app-98qi.onrender.com/last-messages/${user.username}`)
      .then((res) => {

        const map = {};

        res.data.forEach((msg) => {

          const other =
            msg.sender === user.username ? msg.receiver : msg.sender;

          map[other] = msg.message;

        });

        setLastMessages(map);

=======
      res.data.forEach((msg) => {
        const other = msg.sender === user.username ? msg.receiver : msg.sender;
        map[other] = msg.message;
>>>>>>> 170b423 (your message)
      });

      setLastMessages(map);
    });
  }, [user.username]);

  useEffect(() => {
<<<<<<< HEAD

    if (search) {

      axios
        .get(`https://chat-app-98qi.onrender.com/search/${search}`)
        .then((res) => setSearchResults(res.data));

    } else {
=======
    if (!search.trim()) {
>>>>>>> 170b423 (your message)
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      axios
        .get(`${API_BASE}/search/${search.trim()}`)
        .then((res) => setSearchResults(res.data));
    }, 250);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
<<<<<<< HEAD

    axios
      .get(`https://chat-app-98qi.onrender.com/contacts/${user.username}`)
      .then((res) => setContacts(res.data));

=======
    axios.get(`${API_BASE}/contacts/${user.username}`).then((res) => {
      setContacts(res.data);
    });
>>>>>>> 170b423 (your message)
  }, [user.username]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!message.trim() || !selectedUser) return;

    const msgData = {
      sender: user.username,
      receiver: selectedUser.username,
      message: message.trim(),
    };

    socket.emit("sendMessage", msgData);
<<<<<<< HEAD

    await axios.post("https://chat-app-98qi.onrender.com/message", msgData);
=======
    await axios.post(`${API_BASE}/message`, msgData);
>>>>>>> 170b423 (your message)

    setMessage("");
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];

    if (!file || !selectedUser) return;

    const formData = new FormData();
    formData.append("file", file);

<<<<<<< HEAD
    const res = await axios.post(
      "https://chat-app-98qi.onrender.com/upload",
      formData
    );
=======
    const res = await axios.post(`${API_BASE}/upload`, formData);
>>>>>>> 170b423 (your message)

    const fileUrl = `uploads/${res.data.file}`;

    const msgData = {
      sender: user.username,
      receiver: selectedUser.username,
      message: fileUrl,
    };

    socket.emit("sendMessage", msgData);
<<<<<<< HEAD

    await axios.post("https://chat-app-98qi.onrender.com/message", msgData);

=======
    await axios.post(`${API_BASE}/message`, msgData);
>>>>>>> 170b423 (your message)
  };

  const isOnline = (username) => {
    return onlineUsers.some((u) => u.username === username);
  };

  const formatTime = (time) => {
    if (!time) return "";

    return new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const profileInitial = (profileData.displayName || user.username)
    .slice(0, 1)
    .toUpperCase();

  const handleProfileSave = (nextProfile) => {
    setProfileData(nextProfile);
    localStorage.setItem(profileStorageKey, JSON.stringify(nextProfile));

    const nextUser = {
      ...user,
      displayName: nextProfile.displayName || user.username,
      about: nextProfile.about,
      accent: nextProfile.accent,
    };

    onUserUpdate(nextUser);
  };

  const renderLastMessage = (rawText) => {
    if (!rawText) return "No messages yet";

    if (rawText.includes("uploads/")) {
      if (/\.(jpg|jpeg|png|gif|webp)$/i.test(rawText)) {
        return "Photo";
      }

      return "File";
    }

    return rawText;
  };

  const renderChatArea = () => {
    if (activeTab === "status") {
      return (
        <div className="placeholder-panel">
          <h2>Status updates</h2>
          <p>Create temporary updates and view recent status activity.</p>
          <div className="placeholder-grid">
            <div className="placeholder-card">
              <h3>My Status</h3>
              <p>Share text, images, or links for 24 hours.</p>
            </div>
            <div className="placeholder-card">
              <h3>Recent Updates</h3>
              <p>Your contacts' latest status updates will appear here.</p>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "calls") {
      return (
        <div className="placeholder-panel">
          <h2>Calls</h2>
          <p>Track voice/video call history and start a new call quickly.</p>
          <div className="placeholder-grid">
            <div className="placeholder-card">
              <h3>Recent Calls</h3>
              <p>Missed and completed calls will be listed here.</p>
            </div>
            <div className="placeholder-card">
              <h3>Start a Call</h3>
              <p>Select a contact from chats and begin a call.</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <header className="chat-header">
          <div>
            <h2>{selectedUser?.username || "Select a chat"}</h2>
            <p>
              {selectedUser
                ? isOnline(selectedUser.username)
                  ? "Online"
                  : "Offline"
                : "Choose a contact or search users"}
            </p>
          </div>
          <button className="ghost-btn" onClick={() => setShowProfile(true)}>
            Profile
          </button>
        </header>

        <section className="messages" ref={chatRef}>
          {loadingMessages && <p className="info-line">Loading messages...</p>}

          {!loadingMessages && !selectedUser && (
            <p className="info-line">Open any conversation to start chatting.</p>
          )}

          {messages.map((msg, index) => {
            const isMe = msg.sender === user.username;
            return (
              <div
                key={`${msg.created_at || "time"}-${index}`}
                className={`msg-row ${isMe ? "mine" : "other"}`}
              >
                <div className="msg-bubble">
                  {msg.message.includes("uploads/") ? (
                    /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.message) ? (
                      <img
<<<<<<< HEAD
                        src={`https://chat-app-98qi.onrender.com/${msg.message}`}
                        style={{
                          width: "150px",
                          borderRadius: "10px",
                        }}
                        alt="img"
=======
                        src={`${API_BASE}/${msg.message}`}
                        alt="attachment"
                        className="msg-image"
>>>>>>> 170b423 (your message)
                      />
                    ) : (
                      <a
<<<<<<< HEAD
                        href={`https://chat-app-98qi.onrender.com/${msg.message}`}
=======
                        href={`${API_BASE}/${msg.message}`}
>>>>>>> 170b423 (your message)
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download file
                      </a>
                    )
                  ) : (
                    msg.message
                  )}
                  <span className="msg-time">{formatTime(msg.created_at)}</span>
                </div>
              </div>
            );
          })}
        </section>

        {typingUser && selectedUser?.username === typingUser && (
          <div className="typing-line">{typingUser} is typing...</div>
        )}

        <footer className="composer">
          <input
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              socket.emit("typing", user.username);
              setTimeout(() => socket.emit("stopTyping"), 900);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder={
              selectedUser ? "Type a message" : "Select a chat to send messages"
            }
            disabled={!selectedUser}
          />

          <label className={`upload-btn ${!selectedUser ? "disabled" : ""}`}>
            Attach
            <input type="file" onChange={handleFile} disabled={!selectedUser} />
          </label>

          <button className="send-btn" onClick={sendMessage} disabled={!selectedUser}>
            Send
          </button>
        </footer>
      </>
    );
  };

  if (showProfile) {
    return (
      <ProfilePage
        user={user}
        profileData={profileData}
        onBack={() => setShowProfile(false)}
        onSave={handleProfileSave}
        onLogout={onLogout}
      />
    );
  }

  return (
    <div className="chat-app" style={{ "--accent-color": profileData.accent }}>
      <aside className="sidebar">
        <div className="brand">
          <div className="avatar">{profileInitial}</div>
          <div>
            <h1>{profileData.displayName || user.username}</h1>
            <p>{profileData.about || "Available"}</p>
          </div>
        </div>

        <nav className="tab-row">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="search-wrap">
          <input
            placeholder="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveTab("chats");
            }}
          />
        </div>

        {searchResults.length > 0 && (
          <section className="list-section">
            <h3>Search results</h3>
            {searchResults.map((entry, index) => (
              <button
                key={`${entry.username}-${index}`}
                className="list-item"
                onClick={() => {
                  setSelectedUser(entry);
                  setActiveTab("chats");
                }}
              >
                <strong>{entry.username}</strong>
                <span>{isOnline(entry.username) ? "Online" : "Offline"}</span>
              </button>
            ))}
          </section>
        )}

        <section className="list-section contacts">
          <h3>Contacts</h3>
          {contacts.length === 0 && <p className="empty-line">No contacts yet</p>}

          {contacts.map((entry, index) => {
            const username = entry.contact;
            const active = selectedUser?.username === username;

            return (
              <button
                key={`${username}-${index}`}
                className={`list-item ${active ? "active" : ""}`}
                onClick={() => {
                  setSelectedUser({ username });
                  setActiveTab("chats");
                }}
              >
                <strong>{username}</strong>
                <span className="meta-line">
                  <i className={isOnline(username) ? "dot online" : "dot"} />
                  {renderLastMessage(lastMessages[username])}
                </span>
              </button>
            );
          })}
        </section>

        <div className="sidebar-actions">
          <button className="ghost-btn" onClick={() => setShowProfile(true)}>
            Open Profile
          </button>
          <button className="danger-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="chat-main">{renderChatArea()}</main>
    </div>
  );
}

export default Chat;
