require("dotenv").config();
const db = require("./db");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const onlineUsers = new Map();
const activeCalls = new Map();

const runQuery = (query, params = []) =>
  new Promise((resolve, reject) => {
    db.query(query, params, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });

const emitOnlineUsers = () => {
  const users = Array.from(onlineUsers.entries()).map(([username, id]) => ({
    id,
    username,
  }));

  io.emit("onlineUsers", users);
};

const createStorage = (subfolder) =>
  multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const safeExt = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${subfolder}-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`);
    },
  });

const uploadChatFile = multer({ storage: createStorage("chat") });
const uploadProfilePhoto = multer({ storage: createStorage("profile") });
const uploadStatusMedia = multer({ storage: createStorage("status") });

app.use("/uploads", express.static(uploadsDir));

const ensureSchema = async () => {
  try {
    await runQuery(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        username VARCHAR(255) PRIMARY KEY,
        display_name VARCHAR(255) NULL,
        about VARCHAR(255) DEFAULT 'Available',
        phone VARCHAR(30) NULL,
        profile_pic VARCHAR(255) NULL,
        accent VARCHAR(20) DEFAULT '#0f766e',
        notifications TINYINT(1) DEFAULT 1,
        read_receipts TINYINT(1) DEFAULT 1,
        compact_mode TINYINT(1) DEFAULT 0,
        status_privacy VARCHAR(20) DEFAULT 'contacts',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS statuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        text TEXT NULL,
        media_url VARCHAR(255) NULL,
        media_type VARCHAR(30) DEFAULT 'text',
        privacy VARCHAR(20) DEFAULT 'contacts',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        INDEX idx_status_user (username),
        INDEX idx_status_expires (expires_at)
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(255) NOT NULL,
        caller VARCHAR(255) NOT NULL,
        receiver VARCHAR(255) NOT NULL,
        call_type VARCHAR(20) DEFAULT 'voice',
        status VARCHAR(30) DEFAULT 'missed',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME NULL,
        duration_sec INT DEFAULT 0,
        INDEX idx_calls_user_time (caller, started_at),
        INDEX idx_calls_receiver_time (receiver, started_at)
      )
    `);

    console.log("Schema ready");
  } catch (error) {
    console.error("Schema init failed:", error.message);
  }
};

ensureSchema();

const upsertUserProfile = async (username, profile = {}) => {
  await runQuery(
    `
    INSERT INTO user_profiles (
      username,
      display_name,
      about,
      phone,
      profile_pic,
      accent,
      notifications,
      read_receipts,
      compact_mode,
      status_privacy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      about = VALUES(about),
      phone = VALUES(phone),
      profile_pic = COALESCE(VALUES(profile_pic), profile_pic),
      accent = VALUES(accent),
      notifications = VALUES(notifications),
      read_receipts = VALUES(read_receipts),
      compact_mode = VALUES(compact_mode),
      status_privacy = VALUES(status_privacy)
  `,
    [
      username,
      profile.displayName || username,
      profile.about || "Available",
      profile.phone || null,
      profile.profilePic || null,
      profile.accent || "#0f766e",
      profile.notifications ? 1 : 0,
      profile.readReceipts ? 1 : 0,
      profile.compactMode ? 1 : 0,
      profile.statusPrivacy || "contacts",
    ]
  );
};

const getUserProfile = async (username) => {
  const rows = await runQuery(
    `
    SELECT
      u.username,
      u.email,
      COALESCE(p.display_name, u.username) AS displayName,
      COALESCE(p.about, 'Available') AS about,
      COALESCE(p.phone, '') AS phone,
      p.profile_pic AS profilePic,
      COALESCE(p.accent, '#0f766e') AS accent,
      COALESCE(p.notifications, 1) AS notifications,
      COALESCE(p.read_receipts, 1) AS readReceipts,
      COALESCE(p.compact_mode, 0) AS compactMode,
      COALESCE(p.status_privacy, 'contacts') AS statusPrivacy
    FROM users u
    LEFT JOIN user_profiles p ON p.username = u.username
    WHERE u.username = ?
    LIMIT 1
  `,
    [username]
  );

  if (!rows.length) return null;

  const row = rows[0];

  return {
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    about: row.about,
    phone: row.phone,
    profilePic: row.profilePic,
    accent: row.accent,
    notifications: !!row.notifications,
    readReceipts: !!row.readReceipts,
    compactMode: !!row.compactMode,
    statusPrivacy: row.statusPrivacy,
  };
};

const saveCallLog = async ({
  roomId,
  caller,
  receiver,
  callType,
  status,
  startedAt,
  endedAt,
  durationSec,
}) => {
  await runQuery(
    `
      INSERT INTO calls (
        room_id,
        caller,
        receiver,
        call_type,
        status,
        started_at,
        ended_at,
        duration_sec
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      roomId,
      caller,
      receiver,
      callType || "voice",
      status || "completed",
      startedAt || new Date(),
      endedAt || new Date(),
      durationSec || 0,
    ]
  );
};

io.on("connection", (socket) => {
  socket.on("join", (userData) => {
    if (!userData?.username) return;

    onlineUsers.set(userData.username, socket.id);
    emitOnlineUsers();
  });

  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });

  socket.on("stopTyping", () => {
    socket.broadcast.emit("stopTyping");
  });

  socket.on("sendMessage", (data) => {
    const messageWithTime = {
      ...data,
      created_at: new Date(),
      status: "sent",
    };

    const receiverSocketId = onlineUsers.get(data.receiver);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receiveMessage", messageWithTime);
    }

    socket.emit("receiveMessage", messageWithTime);
  });

  socket.on("messageSeen", ({ sender, receiver }) => {
    const query = `
      UPDATE messages
      SET status='seen'
      WHERE sender=? AND receiver=?
    `;

    db.query(query, [sender, receiver]);
  });

  socket.on("call:initiate", async (payload) => {
    const { from, to, callType, roomId } = payload || {};
    if (!from || !to || !roomId) return;

    activeCalls.set(roomId, {
      roomId,
      caller: from,
      receiver: to,
      callType: callType || "voice",
      startedAt: new Date(),
      acceptedAt: null,
    });

    const receiverSocketId = onlineUsers.get(to);

    if (!receiverSocketId) {
      socket.emit("call:unavailable", {
        roomId,
        reason: "offline",
      });

      const session = activeCalls.get(roomId);
      activeCalls.delete(roomId);

      try {
        await saveCallLog({
          roomId,
          caller: session.caller,
          receiver: session.receiver,
          callType: session.callType,
          status: "missed",
          startedAt: session.startedAt,
          endedAt: new Date(),
          durationSec: 0,
        });
      } catch (error) {
        console.error("Failed to log missed call:", error.message);
      }

      return;
    }

    io.to(receiverSocketId).emit("call:incoming", {
      from,
      to,
      roomId,
      callType: callType || "voice",
    });
  });

  socket.on("call:accept", (payload) => {
    const { from, to, roomId } = payload || {};
    if (!from || !to || !roomId) return;

    const session = activeCalls.get(roomId);
    if (session) {
      session.acceptedAt = new Date();
      activeCalls.set(roomId, session);
    }

    const callerSocketId = onlineUsers.get(to);
    if (callerSocketId) {
      io.to(callerSocketId).emit("call:accepted", payload);
    }
  });

  socket.on("call:reject", async (payload) => {
    const { from, to, roomId } = payload || {};
    if (!from || !to || !roomId) return;

    const callerSocketId = onlineUsers.get(to);
    if (callerSocketId) {
      io.to(callerSocketId).emit("call:rejected", payload);
    }

    const session = activeCalls.get(roomId);
    if (session) {
      activeCalls.delete(roomId);

      try {
        await saveCallLog({
          roomId,
          caller: session.caller,
          receiver: session.receiver,
          callType: session.callType,
          status: "rejected",
          startedAt: session.startedAt,
          endedAt: new Date(),
          durationSec: 0,
        });
      } catch (error) {
        console.error("Failed to log rejected call:", error.message);
      }
    }
  });

  socket.on("call:end", async (payload) => {
    const { from, to, roomId, durationSec, status } = payload || {};
    if (!from || !to || !roomId) return;

    const peerSocketId = onlineUsers.get(to);
    if (peerSocketId) {
      io.to(peerSocketId).emit("call:ended", payload);
    }

    const session = activeCalls.get(roomId);
    if (session) {
      activeCalls.delete(roomId);

      try {
        await saveCallLog({
          roomId,
          caller: session.caller,
          receiver: session.receiver,
          callType: session.callType,
          status: status || "completed",
          startedAt: session.startedAt,
          endedAt: new Date(),
          durationSec: durationSec || 0,
        });
      } catch (error) {
        console.error("Failed to log ended call:", error.message);
      }
    }
  });

  socket.on("webrtc:offer", ({ to, ...rest }) => {
    const receiverSocketId = onlineUsers.get(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("webrtc:offer", rest);
    }
  });

  socket.on("webrtc:answer", ({ to, ...rest }) => {
    const receiverSocketId = onlineUsers.get(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("webrtc:answer", rest);
    }
  });

  socket.on("webrtc:ice-candidate", ({ to, ...rest }) => {
    const receiverSocketId = onlineUsers.get(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("webrtc:ice-candidate", rest);
    }
  });

  socket.on("disconnect", async () => {
    const disconnectedUser = Array.from(onlineUsers.entries()).find(
      ([, id]) => id === socket.id
    );

    if (disconnectedUser) {
      const [username] = disconnectedUser;
      onlineUsers.delete(username);

      const sessions = Array.from(activeCalls.values()).filter(
        (call) => call.caller === username || call.receiver === username
      );

      for (const session of sessions) {
        activeCalls.delete(session.roomId);

        const peer = session.caller === username ? session.receiver : session.caller;
        const peerSocketId = onlineUsers.get(peer);

        if (peerSocketId) {
          io.to(peerSocketId).emit("call:ended", {
            roomId: session.roomId,
            reason: "disconnected",
          });
        }

        try {
          await saveCallLog({
            roomId: session.roomId,
            caller: session.caller,
            receiver: session.receiver,
            callType: session.callType,
            status: "dropped",
            startedAt: session.startedAt,
            endedAt: new Date(),
            durationSec: 0,
          });
        } catch (error) {
          console.error("Failed to log dropped call:", error.message);
        }
      }
    }

    emitOnlineUsers();
  });
});

app.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).send("Username, email and password are required");
  }

  const hashed = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users (username,email,password) VALUES (?,?,?)",
    [username, email, hashed],
    async (err) => {
      if (err) return res.status(500).send(err.sqlMessage || "Registration failed");

      try {
        await upsertUserProfile(username, { displayName: username });
      } catch (profileErr) {
        console.error("Profile seed failed:", profileErr.message);
      }

      res.send("Registered");
    }
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], async (err, result) => {
    if (err) return res.status(500).send("Server error");

    if (!result || result.length === 0) {
      return res.status(404).send("User not found");
    }

    const user = result[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) return res.status(401).send("Wrong password");

    let profile = null;

    try {
      profile = await getUserProfile(user.username);
    } catch (profileErr) {
      console.error("Profile load failed:", profileErr.message);
    }

    res.json({
      user: {
        username: user.username,
        email: user.email,
        displayName: profile?.displayName || user.username,
        about: profile?.about || "Available",
        phone: profile?.phone || "",
        profilePic: profile?.profilePic || null,
        accent: profile?.accent || "#0f766e",
        notifications: profile?.notifications ?? true,
        readReceipts: profile?.readReceipts ?? true,
        compactMode: profile?.compactMode ?? false,
        statusPrivacy: profile?.statusPrivacy || "contacts",
      },
    });
  });
});

app.get("/profile/:username", async (req, res) => {
  try {
    const profile = await getUserProfile(req.params.username);

    if (!profile) return res.status(404).send("User not found");

    res.json(profile);
  } catch (error) {
    res.status(500).send("Failed to load profile");
  }
});

app.put("/profile/:username", async (req, res) => {
  const username = req.params.username;
  const body = req.body || {};

  try {
    await upsertUserProfile(username, {
      displayName: body.displayName || username,
      about: body.about || "Available",
      phone: body.phone || null,
      accent: body.accent || "#0f766e",
      notifications: body.notifications !== false,
      readReceipts: body.readReceipts !== false,
      compactMode: !!body.compactMode,
      statusPrivacy: body.statusPrivacy || "contacts",
      profilePic: body.profilePic || null,
    });

    const profile = await getUserProfile(username);
    res.json(profile);
  } catch (error) {
    res.status(500).send("Failed to update profile");
  }
});

app.post(
  "/profile/:username/photo",
  uploadProfilePhoto.single("photo"),
  async (req, res) => {
    const username = req.params.username;

    if (!req.file) return res.status(400).send("Photo file is required");

    const photoPath = `uploads/${req.file.filename}`;

    try {
      const existing = await getUserProfile(username);

      await upsertUserProfile(username, {
        displayName: existing?.displayName || username,
        about: existing?.about || "Available",
        phone: existing?.phone || null,
        accent: existing?.accent || "#0f766e",
        notifications: existing?.notifications ?? true,
        readReceipts: existing?.readReceipts ?? true,
        compactMode: existing?.compactMode ?? false,
        statusPrivacy: existing?.statusPrivacy || "contacts",
        profilePic: photoPath,
      });

      const profile = await getUserProfile(username);
      res.json(profile);
    } catch (error) {
      res.status(500).send("Failed to upload profile photo");
    }
  }
);

app.post("/message", (req, res) => {
  const { sender, receiver, message } = req.body;

  db.query(
    "INSERT INTO messages (sender,receiver,message,status) VALUES (?,?,?,'sent')",
    [sender, receiver, message],
    (err) => {
      if (err) return res.status(500).send(err);

      const contactQuery = `
        INSERT INTO contacts (user1,user2)
        SELECT ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM contacts
          WHERE (user1=? AND user2=?)
          OR (user1=? AND user2=?)
        )
      `;

      db.query(contactQuery, [sender, receiver, sender, receiver, receiver, sender]);

      res.send("Saved");
    }
  );
});

app.get("/messages/:u1/:u2", (req, res) => {
  const { u1, u2 } = req.params;

  db.query(
    `SELECT * FROM messages
     WHERE (sender=? AND receiver=?)
     OR (sender=? AND receiver=?)
     ORDER BY created_at`,
    [u1, u2, u2, u1],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json(result);
    }
  );
});

app.get("/last-messages/:user", (req, res) => {
  db.query(
    `SELECT * FROM messages
     WHERE sender=? OR receiver=?
     ORDER BY created_at DESC`,
    [req.params.user, req.params.user],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const map = {};

      result.forEach((msg) => {
        const other = msg.sender === req.params.user ? msg.receiver : msg.sender;
        if (!map[other]) map[other] = msg;
      });

      res.json(Object.values(map));
    }
  );
});

app.get("/search/:username", (req, res) => {
  const search = `%${req.params.username}%`;

  const query = `
    SELECT
      u.username,
      p.profile_pic AS profilePic,
      COALESCE(p.display_name, u.username) AS displayName,
      COALESCE(p.about, 'Available') AS about
    FROM users u
    LEFT JOIN user_profiles p ON p.username = u.username
    WHERE u.username LIKE ?
    ORDER BY u.username ASC
    LIMIT 20
  `;

  db.query(query, [search], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json(result);
  });
});

app.get("/contacts/:username", (req, res) => {
  const username = req.params.username;

  const query = `
    SELECT
      CASE
        WHEN c.user1=? THEN c.user2
        ELSE c.user1
      END AS contact,
      p.profile_pic AS profilePic,
      COALESCE(p.display_name,
        CASE WHEN c.user1=? THEN c.user2 ELSE c.user1 END
      ) AS displayName,
      COALESCE(p.about, 'Available') AS about
    FROM contacts c
    LEFT JOIN user_profiles p ON p.username =
      CASE WHEN c.user1=? THEN c.user2 ELSE c.user1 END
    WHERE c.user1=? OR c.user2=?
  `;

  db.query(query, [username, username, username, username, username], (err, result) => {
    if (err) return res.status(500).send(err);
    res.json(result);
  });
});

app.post("/upload", uploadChatFile.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("File is required");

  res.json({
    file: req.file.filename,
  });
});

app.post("/statuses", uploadStatusMedia.single("media"), async (req, res) => {
  const { username, text, privacy } = req.body;

  if (!username) return res.status(400).send("Username is required");

  const mediaUrl = req.file ? `uploads/${req.file.filename}` : null;
  const mediaType = req.file
    ? req.file.mimetype.startsWith("image/")
      ? "image"
      : "file"
    : "text";

  if (!text && !mediaUrl) {
    return res.status(400).send("Status text or media is required");
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await runQuery(
      `
      INSERT INTO statuses (username, text, media_url, media_type, privacy, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [username, text || null, mediaUrl, mediaType, privacy || "contacts", expiresAt]
    );

    const statusRows = await runQuery(
      `
      SELECT id, username, text, media_url AS mediaUrl, media_type AS mediaType,
             privacy, created_at AS createdAt, expires_at AS expiresAt
      FROM statuses
      WHERE username=?
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [username]
    );

    res.json(statusRows[0]);
  } catch (error) {
    res.status(500).send("Failed to post status");
  }
});

app.get("/statuses/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const rows = await runQuery(
      `
      SELECT
        s.id,
        s.username,
        s.text,
        s.media_url AS mediaUrl,
        s.media_type AS mediaType,
        s.privacy,
        s.created_at AS createdAt,
        s.expires_at AS expiresAt,
        p.profile_pic AS profilePic,
        COALESCE(p.display_name, s.username) AS displayName
      FROM statuses s
      LEFT JOIN user_profiles p ON p.username = s.username
      WHERE s.username=? AND s.expires_at > NOW()
      ORDER BY s.created_at DESC
      `,
      [username]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).send("Failed to load statuses");
  }
});

app.get("/statuses-feed/:username", async (req, res) => {
  const username = req.params.username;

  try {
    const rows = await runQuery(
      `
      SELECT
        s.id,
        s.username,
        s.text,
        s.media_url AS mediaUrl,
        s.media_type AS mediaType,
        s.privacy,
        s.created_at AS createdAt,
        s.expires_at AS expiresAt,
        p.profile_pic AS profilePic,
        COALESCE(p.display_name, s.username) AS displayName
      FROM statuses s
      LEFT JOIN user_profiles p ON p.username = s.username
      WHERE s.expires_at > NOW()
      AND (
        s.username = ?
        OR (s.privacy = 'everyone')
        OR (
          s.privacy = 'contacts' AND EXISTS (
            SELECT 1
            FROM contacts c
            WHERE (c.user1 = ? AND c.user2 = s.username)
            OR (c.user2 = ? AND c.user1 = s.username)
          )
        )
      )
      ORDER BY s.created_at DESC
      `,
      [username, username, username]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).send("Failed to load status feed");
  }
});

app.get("/calls/:username", async (req, res) => {
  const username = req.params.username;

  try {
    const rows = await runQuery(
      `
      SELECT
        id,
        room_id AS roomId,
        caller,
        receiver,
        call_type AS callType,
        status,
        started_at AS startedAt,
        ended_at AS endedAt,
        duration_sec AS durationSec
      FROM calls
      WHERE caller=? OR receiver=?
      ORDER BY started_at DESC
      LIMIT 100
      `,
      [username, username]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).send("Failed to load call history");
  }
});

server.listen(5000, () => {
  console.log("Server running");
});

