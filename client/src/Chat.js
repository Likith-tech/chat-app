import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import axios from "axios";

const socket = io("https://chat-app-98qi.onrender.com");

function Chat({ user }) {

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUser, setTypingUser] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [lastMessages, setLastMessages] = useState({});

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [contacts, setContacts] = useState([]);

  const chatRef = useRef(null);

  // ================= TIME FORMAT =================

  const formatTime = (time) => {
    if (!time) return "";

    return new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ================= JOIN =================

  useEffect(() => {
    if (user) socket.emit("join", user);
  }, [user]);

  // ================= SOCKET =================

  useEffect(() => {

    socket.on("onlineUsers", (users) => {
      setOnlineUsers(users);
    });

    socket.on("typing", (username) => {
      setTypingUser(username);
    });

    socket.on("stopTyping", () => {
      setTypingUser("");
    });

    socket.on("receiveMessage", (data) => {

      if (!selectedUser) return;

      const isRelevant =
        (data.sender === user.username &&
          data.receiver === selectedUser.username) ||
        (data.sender === selectedUser.username &&
          data.receiver === user.username);

      if (isRelevant) {
        setMessages((prev) => [...prev, data]);
      }

    });

    return () => socket.off();

  }, [selectedUser, user]);

  // ================= LOAD MESSAGES =================

  useEffect(() => {

    if (!selectedUser) {
      setMessages([]);
      return;
    }

    axios
      .get(
        `http://localhost:5000/messages/${user.username}/${selectedUser.username}`
      )
      .then((res) => setMessages(res.data));

  }, [selectedUser, user.username]);

  // ================= LAST MESSAGE =================

  useEffect(() => {

    axios
      .get(`http://localhost:5000/last-messages/${user.username}`)
      .then((res) => {

        const map = {};

        res.data.forEach((msg) => {

          const other =
            msg.sender === user.username ? msg.receiver : msg.sender;

          map[other] = msg.message;

        });

        setLastMessages(map);

      });

  }, [user.username]);

  // ================= SEARCH =================

  useEffect(() => {

    if (search) {

      axios
        .get(`http://localhost:5000/search/${search}`)
        .then((res) => setSearchResults(res.data));

    } else {
      setSearchResults([]);
    }

  }, [search]);

  // ================= CONTACTS =================

  useEffect(() => {

    axios
      .get(`http://localhost:5000/contacts/${user.username}`)
      .then((res) => setContacts(res.data));

  }, [user.username]);

  // ================= SCROLL =================

  useEffect(() => {

    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }

  }, [messages]);

  // ================= SEND MESSAGE =================

  const sendMessage = async () => {

    if (!message.trim() || !selectedUser) return;

    const msgData = {
      sender: user.username,
      receiver: selectedUser.username,
      message,
    };

    socket.emit("sendMessage", msgData);

    await axios.post("http://localhost:5000/message", msgData);

    setMessage("");

  };

  // ================= FILE SEND =================

  const handleFile = async (e) => {

    const file = e.target.files[0];

    const formData = new FormData();
    formData.append("file", file);

    const res = await axios.post(
      "http://localhost:5000/upload",
      formData
    );

    const fileUrl = `uploads/${res.data.file}`;

    const msgData = {
      sender: user.username,
      receiver: selectedUser.username,
      message: fileUrl,
    };

    socket.emit("sendMessage", msgData);

    await axios.post("http://localhost:5000/message", msgData);

  };

  // ================= ONLINE CHECK =================

  const isOnline = (username) => {
    return onlineUsers.some((u) => u.username === username);
  };

  // ================= UI =================

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Arial" }}>

      {/* ================= SIDEBAR ================= */}

      <div
        style={{
          width: "25%",
          backgroundColor: "#f0f0f0",
          borderRight: "1px solid #ccc",
        }}
      >

        <input
          placeholder="Search user..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "95%",
            padding: "8px",
            margin: "10px",
          }}
        />

        {searchResults.map((u, i) => (
          <div
            key={i}
            onClick={() => setSelectedUser(u)}
            style={{
              padding: "10px",
              borderBottom: "1px solid #ddd",
              cursor: "pointer",
            }}
          >
            🔍 {u.username}
          </div>
        ))}

        <hr />

        {contacts.map((c, i) => {

          const username = c.contact;

          return (
            <div
              key={i}
              onClick={() => setSelectedUser({ username })}
              style={{
                padding: "10px",
                borderBottom: "1px solid #ddd",
                cursor: "pointer",
                backgroundColor:
                  selectedUser?.username === username
                    ? "#ddd"
                    : "transparent",
              }}
            >

              <span
                style={{
                  color: isOnline(username) ? "green" : "gray",
                }}
              >
                ●
              </span>{" "}
              {username}

              <div
                style={{
                  fontSize: "12px",
                  color: "gray",
                }}
              >
                {lastMessages[username]}
              </div>

            </div>
          );
        })}

      </div>

      {/* ================= CHAT ================= */}

      <div style={{ width: "75%", display: "flex", flexDirection: "column" }}>

        {/* HEADER */}

        <div
          style={{
            backgroundColor: "#075E54",
            color: "white",
            padding: "15px",
          }}
        >

          <div>
            {selectedUser?.username}

            <div style={{ fontSize: "12px", color: "#ddd" }}>
              {isOnline(selectedUser?.username)
                ? "Online"
                : "Offline"}
            </div>
          </div>

        </div>

        {/* CHAT BOX */}

        <div
          ref={chatRef}
          style={{
            flex: 1,
            overflowY: "scroll",
            backgroundColor: "#ECE5DD",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
          }}
        >

          {messages.map((msg, i) => {

            const isMe = msg.sender === user.username;

            return (
              <div
                key={i}
                style={{
                  alignSelf: isMe ? "flex-end" : "flex-start",
                  margin: "5px 0",
                }}
              >

                <div
                  style={{
                    backgroundColor: isMe ? "#DCF8C6" : "#fff",
                    padding: "10px 14px",
                    borderRadius: "18px",
                    fontSize: "14px",
                    lineHeight: "1.4",
                    maxWidth: "60%",
                  }}
                >

                  {/* MESSAGE CONTENT */}

                  {msg.message.includes("uploads") ? (

                    msg.message.match(/\.(jpg|png|jpeg|gif)$/) ? (

                      <img
                        src={`http://localhost:5000/${msg.message}`}
                        style={{
                          width: "150px",
                          borderRadius: "10px",
                        }}
                        alt="img"
                      />

                    ) : (

                      <a
                        href={`http://localhost:5000/${msg.message}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        📎 Download File
                      </a>

                    )

                  ) : (
                    msg.message
                  )}

                  <div
                    style={{
                      fontSize: "10px",
                      color: "gray",
                      textAlign: "right",
                    }}
                  >
                    {formatTime(msg.created_at)}
                  </div>

                </div>

              </div>
            );
          })}

        </div>

        {/* TYPING */}

        {typingUser && (
          <div style={{ padding: "5px 10px", fontStyle: "italic" }}>
            {typingUser} typing...
          </div>
        )}

        {/* INPUT */}

        <div
          style={{
            display: "flex",
            gap: "10px",
            padding: "10px",
            borderTop: "1px solid #ccc",
          }}
        >

          <input
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: "20px",
              border: "1px solid #ccc",
            }}
            value={message}
            onChange={(e) => {

              setMessage(e.target.value);

              socket.emit("typing", user.username);

              setTimeout(() => {
                socket.emit("stopTyping");
              }, 1000);

            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder="Type message..."
            disabled={!selectedUser}
          />

          <button onClick={sendMessage}>➤</button>

          {/* FILE INPUT */}

          <input type="file" onChange={handleFile} />

        </div>

      </div>

    </div>
  );
}

export default Chat;