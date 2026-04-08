import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import ProfilePage from "./ProfilePage";
import { api, API_BASE } from "./api";
import "./Chat.css";

const socket = io(API_BASE, {
  autoConnect: false,
  transports: ["websocket", "polling"],
});

const TABS = [
  { id: "chats", label: "Chats" },
  { id: "status", label: "Status" },
  { id: "calls", label: "Calls" },
];

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const defaultProfile = {
  displayName: "",
  about: "Available",
  phone: "",
  accent: "#0f766e",
  notifications: true,
  readReceipts: true,
  compactMode: false,
  statusPrivacy: "contacts",
  profilePic: null,
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

  const [profileData, setProfileData] = useState({
    ...defaultProfile,
    ...user,
    displayName: user.displayName || user.username,
  });

  const [statusText, setStatusText] = useState("");
  const [statusFile, setStatusFile] = useState(null);
  const [statusFeed, setStatusFeed] = useState([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusPosting, setStatusPosting] = useState(false);

  const [callHistory, setCallHistory] = useState([]);
  const [callsLoading, setCallsLoading] = useState(false);

  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callError, setCallError] = useState("");
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const chatRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const activeCallRef = useRef(null);
  const callStartRef = useRef(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const avatarLabel = (name) => (name || "U").slice(0, 1).toUpperCase();

  const avatarUrl = (path) => {
    if (!path) return null;
    return `${API_BASE}/${path}`;
  };

  const compactModeClass = profileData.compactMode ? "compact" : "";

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream || null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream]);

  useEffect(() => {
    const hydrateProfile = async () => {
      try {
        const res = await api.get(`/profile/${user.username}`);
        const merged = {
          ...defaultProfile,
          ...res.data,
          displayName: res.data.displayName || user.username,
        };
        setProfileData(merged);
        onUserUpdate({ ...user, ...merged });
      } catch {
        setProfileData((prev) => ({
          ...prev,
          displayName: prev.displayName || user.username,
        }));
      }
    };

    hydrateProfile();
  }, [onUserUpdate, user, user.username]);

  useEffect(() => {
    socket.auth = { token: localStorage.getItem("token") };

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      socket.disconnect();
    };
  }, [user.username]);

  const cleanupCall = useCallback((options = {}) => {
    const { keepError = "" } = options;

    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
    }

    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    callStartRef.current = null;

    if (keepError) {
      setCallError(keepError);
      setTimeout(() => setCallError(""), 3500);
    }
  }, [localStream, remoteStream]);

  const ensureLocalMedia = useCallback(async (callType) => {
    const wantsVideo = callType === "video";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantsVideo,
    });

    setLocalStream(stream);
    return stream;
  }, []);

  const createPeerConnection = useCallback((peerUsername, roomId, mediaStream) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const pc = new RTCPeerConnection(rtcConfig);

    mediaStream.getTracks().forEach((track) => {
      pc.addTrack(track, mediaStream);
    });

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc:ice-candidate", {
          to: peerUsername,
          from: user.username,
          roomId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        cleanupCall({ keepError: "Call disconnected" });
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [cleanupCall, user.username]);

  const loadCallHistory = useCallback(async () => {
    setCallsLoading(true);
    try {
      const res = await api.get(`/calls/${user.username}`);
      setCallHistory(res.data);
    } catch {
      setCallHistory([]);
    } finally {
      setCallsLoading(false);
    }
  }, [user.username]);

  useEffect(() => {
    const handleOnlineUsers = (users) => setOnlineUsers(users);

    const handleTyping = (payload) => {
      if (payload?.from === selectedUser?.username) {
        setTypingUser(payload.from);
      }
    };

    const handleStopTyping = (payload) => {
      if (!payload?.from || payload.from === selectedUser?.username) {
        setTypingUser("");
      }
    };

    const handleReceiveMessage = (data) => {
      const otherUser =
        data.sender === user.username ? data.receiver : data.sender;

      setLastMessages((prev) => ({
        ...prev,
        [otherUser]: data.message,
      }));

      setContacts((prev) => {
        const alreadyExists = prev.some((c) => c.contact === otherUser);
        return alreadyExists ? prev : [...prev, { contact: otherUser, displayName: otherUser }];
      });

      if (!selectedUser) return;

      const isRelevant =
        (data.sender === user.username && data.receiver === selectedUser.username) ||
        (data.sender === selectedUser.username && data.receiver === user.username);

      if (isRelevant) {
        setMessages((prev) => [...prev, data]);
      }
    };

    const handleIncomingCall = (payload) => {
      setIncomingCall(payload);
      setActiveTab("calls");
    };

    const handleCallAccepted = (payload) => {
      if (activeCallRef.current?.roomId !== payload.roomId) return;

      callStartRef.current = new Date();
      setActiveCall((prev) =>
        prev ? { ...prev, status: "connected", acceptedAt: new Date() } : prev
      );
      setCallError("");
    };

    const handleCallRejected = (payload) => {
      if (activeCallRef.current?.roomId !== payload.roomId) return;
      cleanupCall({ keepError: "Call declined" });
      loadCallHistory();
    };

    const handleCallUnavailable = (payload) => {
      if (activeCallRef.current?.roomId !== payload.roomId) return;
      cleanupCall({ keepError: "User is offline" });
      loadCallHistory();
    };

    const handleCallEnded = () => {
      cleanupCall({ keepError: "Call ended" });
      loadCallHistory();
    };

    const handleOffer = async ({ from, roomId, offer, callType }) => {
      try {
        const stream = localStream || (await ensureLocalMedia(callType || "voice"));
        const pc = createPeerConnection(from, roomId, stream);

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          to: from,
          from: user.username,
          roomId,
          answer,
        });

        callStartRef.current = new Date();
        setActiveCall((prev) =>
          prev
            ? { ...prev, roomId, peerUsername: from, callType: callType || prev.callType, status: "connected" }
            : {
                roomId,
                peerUsername: from,
                callType: callType || "voice",
                direction: "incoming",
                status: "connected",
              }
        );
      } catch {
        setCallError("Failed to connect call");
      }
    };

    const handleAnswer = async ({ roomId, answer }) => {
      if (activeCallRef.current?.roomId !== roomId || !peerConnectionRef.current) return;

      try {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch {
        setCallError("Call answer failed");
      }
    };

    const handleIceCandidate = async ({ roomId, candidate }) => {
      if (!candidate) return;
      if (activeCallRef.current?.roomId !== roomId || !peerConnectionRef.current) return;

      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignore transient ICE candidate failures
      }
    };

    socket.on("onlineUsers", handleOnlineUsers);
    socket.on("typing", handleTyping);
    socket.on("stopTyping", handleStopTyping);
    socket.on("receiveMessage", handleReceiveMessage);

    socket.on("call:incoming", handleIncomingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("call:rejected", handleCallRejected);
    socket.on("call:unavailable", handleCallUnavailable);
    socket.on("call:ended", handleCallEnded);

    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
    socket.on("webrtc:ice-candidate", handleIceCandidate);

    return () => {
      socket.off("onlineUsers", handleOnlineUsers);
      socket.off("typing", handleTyping);
      socket.off("stopTyping", handleStopTyping);
      socket.off("receiveMessage", handleReceiveMessage);

      socket.off("call:incoming", handleIncomingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("call:rejected", handleCallRejected);
      socket.off("call:unavailable", handleCallUnavailable);
      socket.off("call:ended", handleCallEnded);

      socket.off("webrtc:offer", handleOffer);
      socket.off("webrtc:answer", handleAnswer);
      socket.off("webrtc:ice-candidate", handleIceCandidate);
    };
  }, [cleanupCall, createPeerConnection, ensureLocalMedia, loadCallHistory, selectedUser, user.username, localStream]);

  useEffect(() => {
    if (!selectedUser) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);

    const loadMessages = () =>
      api
        .get(`/messages/${user.username}/${selectedUser.username}`)
        .then((res) => setMessages(res.data))
        .finally(() => setLoadingMessages(false));

    loadMessages();

    const interval = setInterval(loadMessages, 4000);
    return () => clearInterval(interval);
  }, [selectedUser, user.username]);

  useEffect(() => {
    api.get(`/last-messages/${user.username}`).then((res) => {
      const map = {};

      res.data.forEach((msg) => {
        const other = msg.sender === user.username ? msg.receiver : msg.sender;
        map[other] = msg.message;
      });

      setLastMessages(map);
    });
  }, [user.username]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      api.get(`/search/${search.trim()}`).then((res) => setSearchResults(res.data));
    }, 250);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    api.get(`/contacts/${user.username}`).then((res) => {
      setContacts(res.data);
    });
  }, [user.username]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (activeTab === "status") {
      setStatusLoading(true);
      api
        .get(`/statuses-feed/${user.username}`)
        .then((res) => setStatusFeed(res.data))
        .finally(() => setStatusLoading(false));
    }

    if (activeTab === "calls") {
      loadCallHistory();
    }
  }, [activeTab, loadCallHistory, user.username]);

  const sendMessage = async () => {
    if (!message.trim() || !selectedUser) return;

    const msgData = {
      sender: user.username,
      receiver: selectedUser.username,
      message: message.trim(),
    };

    await api.post(`/message`, msgData);

    setMessage("");
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];

    if (!file || !selectedUser) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await api.post(`/upload`, formData);

    const fileUrl = `uploads/${res.data.file}`;

    const msgData = {
      sender: user.username,
      receiver: selectedUser.username,
      message: fileUrl,
    };

    socket.emit("sendMessage", msgData);
    await api.post(`/message`, msgData);
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

  const formatDateTime = (time) => {
    if (!time) return "";

    return new Date(time).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const saveProfile = async (nextProfile) => {
    const payload = {
      displayName: nextProfile.displayName || user.username,
      about: nextProfile.about,
      phone: nextProfile.phone,
      accent: nextProfile.accent,
      notifications: nextProfile.notifications,
      readReceipts: nextProfile.readReceipts,
      compactMode: nextProfile.compactMode,
      statusPrivacy: nextProfile.statusPrivacy,
      profilePic: profileData.profilePic,
    };

    const res = await api.put(`/profile/${user.username}`, payload);
    const merged = { ...defaultProfile, ...res.data };

    setProfileData(merged);
    onUserUpdate({ ...user, ...merged });
    return merged;
  };

  const uploadProfilePhoto = async (file) => {
    const formData = new FormData();
    formData.append("photo", file);

    const res = await api.post(`/profile/${user.username}/photo`, formData);
    const merged = { ...defaultProfile, ...res.data };

    setProfileData(merged);
    onUserUpdate({ ...user, ...merged });

    return merged;
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

  const postStatus = async () => {
    if (!statusText.trim() && !statusFile) return;

    setStatusPosting(true);

    const formData = new FormData();
    formData.append("username", user.username);
    formData.append("text", statusText.trim());
    formData.append("privacy", profileData.statusPrivacy);

    if (statusFile) {
      formData.append("media", statusFile);
    }

    try {
      await api.post(`/statuses`, formData);
      setStatusText("");
      setStatusFile(null);

      const feed = await api.get(`/statuses-feed/${user.username}`);
      setStatusFeed(feed.data);
    } finally {
      setStatusPosting(false);
    }
  };

  const startOutgoingCall = async (callType) => {
    if (!selectedUser) return;

    try {
      setCallError("");
      const roomId = `${user.username}-${selectedUser.username}-${Date.now()}`;

      const stream = await ensureLocalMedia(callType);
      const pc = createPeerConnection(selectedUser.username, roomId, stream);

      setActiveCall({
        roomId,
        peerUsername: selectedUser.username,
        callType,
        direction: "outgoing",
        status: "calling",
      });

      socket.emit("call:initiate", {
        from: user.username,
        to: selectedUser.username,
        roomId,
        callType,
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc:offer", {
        to: selectedUser.username,
        from: user.username,
        roomId,
        callType,
        offer,
      });
    } catch {
      cleanupCall({ keepError: "Microphone/Camera access denied" });
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;

    try {
      const stream = await ensureLocalMedia(incomingCall.callType || "voice");
      createPeerConnection(incomingCall.from, incomingCall.roomId, stream);

      setActiveCall({
        roomId: incomingCall.roomId,
        peerUsername: incomingCall.from,
        callType: incomingCall.callType || "voice",
        direction: "incoming",
        status: "connecting",
      });

      socket.emit("call:accept", {
        from: user.username,
        to: incomingCall.from,
        roomId: incomingCall.roomId,
        callType: incomingCall.callType || "voice",
      });

      setIncomingCall(null);
    } catch {
      setCallError("Unable to access device for call");
    }
  };

  const rejectIncomingCall = () => {
    if (!incomingCall) return;

    socket.emit("call:reject", {
      from: user.username,
      to: incomingCall.from,
      roomId: incomingCall.roomId,
      callType: incomingCall.callType || "voice",
    });

    setIncomingCall(null);
  };

  const endCurrentCall = () => {
    if (!activeCallRef.current) return;

    const now = Date.now();
    const started = callStartRef.current ? callStartRef.current.getTime() : now;
    const durationSec = Math.max(0, Math.floor((now - started) / 1000));

    socket.emit("call:end", {
      from: user.username,
      to: activeCallRef.current.peerUsername,
      roomId: activeCallRef.current.roomId,
      callType: activeCallRef.current.callType,
      durationSec,
      status: "completed",
    });

    cleanupCall();
    loadCallHistory();
  };

  const groupedStatusFeed = useMemo(() => {
    const groups = new Map();

    statusFeed.forEach((status) => {
      if (!groups.has(status.username)) {
        groups.set(status.username, {
          username: status.username,
          displayName: status.displayName || status.username,
          profilePic: status.profilePic,
          items: [],
        });
      }

      groups.get(status.username).items.push(status);
    });

    return Array.from(groups.values());
  }, [statusFeed]);

  const renderCallBadge = (entry) => {
    if (entry.callType === "video") return "Video";
    return "Voice";
  };

  const renderStatusPanel = () => (
    <div className="status-panel">
      <div className="status-composer">
        <h2>Status</h2>
        <textarea
          value={statusText}
          onChange={(e) => setStatusText(e.target.value)}
          placeholder="Share an update"
          rows={3}
        />

        <div className="status-actions-row">
          <label className="upload-btn">
            Add media
            <input type="file" onChange={(e) => setStatusFile(e.target.files?.[0] || null)} />
          </label>

          <button className="send-btn" onClick={postStatus} disabled={statusPosting}>
            {statusPosting ? "Posting..." : "Post status"}
          </button>
        </div>

        {statusFile && <p className="info-line">Selected: {statusFile.name}</p>}
      </div>

      <div className="status-feed">
        <h3>Recent updates</h3>
        {statusLoading && <p className="info-line">Loading statuses...</p>}

        {!statusLoading && groupedStatusFeed.length === 0 && (
          <p className="info-line">No statuses yet.</p>
        )}

        {groupedStatusFeed.map((group) => (
          <article key={group.username} className="status-group">
            <div className="status-user">
              {group.profilePic ? (
                <img src={avatarUrl(group.profilePic)} alt={group.displayName} className="status-avatar" />
              ) : (
                <div className="avatar small">{avatarLabel(group.displayName)}</div>
              )}
              <strong>{group.displayName}</strong>
            </div>

            <div className="status-items">
              {group.items.map((item) => (
                <div key={item.id} className="status-item">
                  {item.text && <p>{item.text}</p>}
                  {item.mediaUrl && (
                    /\.(jpg|jpeg|png|gif|webp)$/i.test(item.mediaUrl) ? (
                      <img src={avatarUrl(item.mediaUrl)} alt="status" className="status-image" />
                    ) : (
                      <a href={avatarUrl(item.mediaUrl)} target="_blank" rel="noreferrer">
                        View attachment
                      </a>
                    )
                  )}
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );

  const renderCallsPanel = () => (
    <div className="calls-panel">
      <h2>Calls</h2>
      <p className="info-line">Start a voice/video call from an active chat.</p>

      {callsLoading && <p className="info-line">Loading call history...</p>}

      {!callsLoading && callHistory.length === 0 && (
        <p className="info-line">No call history yet.</p>
      )}

      {!callsLoading &&
        callHistory.map((entry) => {
          const isCaller = entry.caller === user.username;
          const withUser = isCaller ? entry.receiver : entry.caller;

          return (
            <div key={entry.id} className="call-row">
              <div>
                <strong>{withUser}</strong>
                <p>
                  {renderCallBadge(entry)} â€¢ {entry.status}
                </p>
              </div>
              <div className="call-meta">
                <span>{formatDateTime(entry.startedAt)}</span>
                <span>{entry.durationSec || 0}s</span>
              </div>
            </div>
          );
        })}
    </div>
  );

  const renderChatArea = () => {
    if (activeTab === "status") return renderStatusPanel();
    if (activeTab === "calls") return renderCallsPanel();

    return (
      <>
        <header className="chat-header">
          <div>
            <h2>{selectedUser?.displayName || selectedUser?.username || "Select a chat"}</h2>
            <p>
              {selectedUser
                ? isOnline(selectedUser.username)
                  ? "Online"
                  : "Offline"
                : "Choose a contact or search users"}
            </p>
          </div>

          <div className="chat-header-actions">
            <button
              className="ghost-btn"
              onClick={() => startOutgoingCall("voice")}
              disabled={!selectedUser}
            >
              Voice Call
            </button>
            <button
              className="ghost-btn"
              onClick={() => startOutgoingCall("video")}
              disabled={!selectedUser}
            >
              Video Call
            </button>
            <button className="ghost-btn" onClick={() => setShowProfile(true)}>
              Profile
            </button>
          </div>
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
                      <img src={avatarUrl(msg.message)} alt="attachment" className="msg-image" />
                    ) : (
                      <a href={avatarUrl(msg.message)} target="_blank" rel="noreferrer">
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
              if (selectedUser?.username) {
                socket.emit("typing", { to: selectedUser.username });
                setTimeout(
                  () => socket.emit("stopTyping", { to: selectedUser.username }),
                  900
                );
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder={selectedUser ? "Type a message" : "Select a chat to send messages"}
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
        onSave={saveProfile}
        onUploadPhoto={uploadProfilePhoto}
        onLogout={onLogout}
        apiBase={API_BASE}
      />
    );
  }

  return (
    <div
      className={`chat-app ${compactModeClass}`}
      style={{ "--accent-color": profileData.accent }}
    >
      <aside className="sidebar">
        <div className="brand">
          {profileData.profilePic ? (
            <img src={avatarUrl(profileData.profilePic)} alt="profile" className="avatar-image" />
          ) : (
            <div className="avatar">{avatarLabel(profileData.displayName || user.username)}</div>
          )}
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
                <strong>{entry.displayName || entry.username}</strong>
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
                  setSelectedUser(entry);
                  setActiveTab("chats");
                }}
              >
                <strong>{entry.displayName || username}</strong>
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

      {incomingCall && !activeCall && (
        <div className="call-popup">
          <p>
            Incoming {incomingCall.callType} call from <strong>{incomingCall.from}</strong>
          </p>
          <div className="call-popup-actions">
            <button className="send-btn" onClick={acceptIncomingCall}>
              Accept
            </button>
            <button className="danger-btn" onClick={rejectIncomingCall}>
              Decline
            </button>
          </div>
        </div>
      )}

      {activeCall && (
        <div className="active-call-overlay">
          <div className="active-call-card">
            <h3>
              {activeCall.callType === "video" ? "Video" : "Voice"} call with {activeCall.peerUsername}
            </h3>
            <p>Status: {activeCall.status}</p>

            {activeCall.callType === "video" ? (
              <div className="video-grid">
                <video ref={localVideoRef} autoPlay muted playsInline className="video-tile" />
                <video ref={remoteVideoRef} autoPlay playsInline className="video-tile" />
              </div>
            ) : (
              <div className="voice-placeholder">Voice call in progress...</div>
            )}

            <button className="danger-btn" onClick={endCurrentCall}>
              End Call
            </button>
          </div>
        </div>
      )}

      {callError && <div className="call-error">{callError}</div>}
    </div>
  );
}

export default Chat;





