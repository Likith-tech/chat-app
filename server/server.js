require("dotenv").config();
const db = require("./db");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const DB_NAME = process.env.DB_NAME;

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
};

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Socket CORS blocked for origin: ${origin}`));
    },
  },
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

const getTokenFromHeader = (headerValue = "") => {
  if (!headerValue.startsWith("Bearer ")) return null;
  return headerValue.slice("Bearer ".length).trim();
};

const signToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
  });

const requireAuth = (req, res, next) => {
  const token = getTokenFromHeader(req.headers.authorization || "");

  if (!token) {
    return res.status(401).json({ message: "Missing auth token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const requireSameUser = (req, res, usernameToMatch) => {
  if (req.user?.username !== usernameToMatch) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }

  return true;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

const addSocketForUser = (username, socketId) => {
  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }

  onlineUsers.get(username).add(socketId);
};

const removeSocketForUser = (username, socketId) => {
  const set = onlineUsers.get(username);
  if (!set) return;

  set.delete(socketId);

  if (set.size === 0) {
    onlineUsers.delete(username);
  }
};

const getSocketIds = (username) => {
  const set = onlineUsers.get(username);
  return set ? Array.from(set) : [];
};

const emitToUser = (username, eventName, payload) => {
  const ids = getSocketIds(username);
  ids.forEach((id) => io.to(id).emit(eventName, payload));
};

const emitOnlineUsers = () => {
  const users = Array.from(onlineUsers.entries()).map(([username, ids]) => ({
    username,
    sockets: ids.size,
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

const ensureUniqueIndex = async (tableName, indexName, columnName) => {
  if (!DB_NAME) return;

  const rows = await runQuery(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = ?
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [DB_NAME, tableName, indexName]
  );

  if (rows.length === 0) {
    await runQuery(
      `CREATE UNIQUE INDEX ${indexName} ON ${tableName}(${columnName})`
    );
  }
};

const ensureSchema = async () => {
  try {
    await ensureUniqueIndex("users", "uniq_users_username", "username");
    await ensureUniqueIndex("users", "uniq_users_email", "email");

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

io.use((socket, next) => {
  const authToken = socket.handshake.auth?.token;
  const headerToken = getTokenFromHeader(socket.handshake.headers.authorization || "");
  const token = authToken || headerToken;

  if (!token) {
    next(new Error("Unauthorized socket"));
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error("Invalid socket token"));
  }
});

io.on("connection", (socket) => {
  const socketUsername = socket.user?.username;

  if (socketUsername) {
    addSocketForUser(socketUsername, socket.id);
    emitOnlineUsers();
  }

  socket.on("typing", ({ to }) => {
    if (!socketUsername || !to) return;
    emitToUser(to, "typing", { from: socketUsername });
  });

  socket.on("stopTyping", ({ to }) => {
    if (!socketUsername || !to) return;
    emitToUser(to, "stopTyping", { from: socketUsername });
  });

  socket.on("messageSeen", ({ sender, receiver }) => {
    if (!socketUsername || socketUsername !== receiver) return;

    const query = `
      UPDATE messages
      SET status='seen'
      WHERE sender=? AND receiver=?
    `;

    db.query(query, [sender, receiver]);
  });

  socket.on("call:initiate", async (payload) => {
    const { to, callType, roomId } = payload || {};
    const from = socketUsername;

    if (!from || !to || !roomId) return;

    activeCalls.set(roomId, {
      roomId,
      caller: from,
      receiver: to,
      callType: callType || "voice",
      startedAt: new Date(),
      acceptedAt: null,
    });

    const receiverSockets = getSocketIds(to);

    if (receiverSockets.length === 0) {
      emitToUser(from, "call:unavailable", {
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

    emitToUser(to, "call:incoming", {
      from,
      to,
      roomId,
      callType: callType || "voice",
    });
  });

  socket.on("call:accept", (payload) => {
    const { to, roomId } = payload || {};
    const from = socketUsername;

    if (!from || !to || !roomId) return;

    const session = activeCalls.get(roomId);
    if (session) {
      session.acceptedAt = new Date();
      activeCalls.set(roomId, session);
    }

    emitToUser(to, "call:accepted", {
      from,
      to,
      roomId,
      callType: payload?.callType || "voice",
    });
  });

  socket.on("call:reject", async (payload) => {
    const { to, roomId } = payload || {};
    const from = socketUsername;

    if (!from || !to || !roomId) return;

    emitToUser(to, "call:rejected", {
      from,
      to,
      roomId,
      callType: payload?.callType || "voice",
    });

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
    const { to, roomId, durationSec, status } = payload || {};
    const from = socketUsername;

    if (!from || !to || !roomId) return;

    emitToUser(to, "call:ended", {
      from,
      to,
      roomId,
      durationSec: durationSec || 0,
      status: status || "completed",
    });

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
    if (!socketUsername || !to) return;
    emitToUser(to, "webrtc:offer", { ...rest, from: socketUsername });
  });

  socket.on("webrtc:answer", ({ to, ...rest }) => {
    if (!socketUsername || !to) return;
    emitToUser(to, "webrtc:answer", { ...rest, from: socketUsername });
  });

  socket.on("webrtc:ice-candidate", ({ to, ...rest }) => {
    if (!socketUsername || !to) return;
    emitToUser(to, "webrtc:ice-candidate", { ...rest, from: socketUsername });
  });

  socket.on("disconnect", async () => {
    if (socketUsername) {
      removeSocketForUser(socketUsername, socket.id);

      const sessions = Array.from(activeCalls.values()).filter(
        (call) => call.caller === socketUsername || call.receiver === socketUsername
      );

      for (const session of sessions) {
        activeCalls.delete(session.roomId);

        const peer =
          session.caller === socketUsername ? session.receiver : session.caller;

        emitToUser(peer, "call:ended", {
          roomId: session.roomId,
          reason: "disconnected",
        });

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

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "chat-backend" });
});

app.post("/register", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!username || !email || !password) {
    return res.status(400).json({ message: "Username, email and password are required" });
  }

  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  if (!passwordRegex.test(password)) {
    return res.status(400).json({
      message:
        "Password must be at least 8 chars and include uppercase, lowercase, number and special character",
    });
  }

  try {
    const duplicateRows = await runQuery(
      `
      SELECT username, email
      FROM users
      WHERE username = ? OR email = ?
      LIMIT 1
      `,
      [username, email]
    );

    if (duplicateRows.length) {
      const duplicate = duplicateRows[0];
      if (duplicate.username === username) {
        return res.status(409).json({ message: "Username already exists" });
      }
      if (duplicate.email === email) {
        return res.status(409).json({ message: "Email already exists" });
      }
    }

    const hashed = await bcrypt.hash(password, 10);

    await runQuery("INSERT INTO users (username,email,password) VALUES (?,?,?)", [
      username,
      email,
      hashed,
    ]);

    await upsertUserProfile(username, { displayName: username });

    return res.status(201).json({ message: "Registered" });
  } catch (err) {
    if (err?.errno === 1062) {
      return res.status(409).json({ message: "Username or email already exists" });
    }
    return res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const result = await runQuery("SELECT * FROM users WHERE email=? LIMIT 1", [email]);

    if (!result || result.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const profile = await getUserProfile(user.username);
    const token = signToken({
      username: user.username,
      email: user.email,
    });

    return res.json({
      token,
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
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
});

app.get("/profile/:username", requireAuth, async (req, res) => {
  if (!requireSameUser(req, res, req.params.username)) return;

  try {
    const profile = await getUserProfile(req.params.username);

    if (!profile) return res.status(404).json({ message: "User not found" });

    res.json(profile);
  } catch {
    res.status(500).json({ message: "Failed to load profile" });
  }
});

app.put("/profile/:username", requireAuth, async (req, res) => {
  const username = req.params.username;
  if (!requireSameUser(req, res, username)) return;

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
  } catch {
    res.status(500).json({ message: "Failed to update profile" });
  }
});

app.post(
  "/profile/:username/photo",
  requireAuth,
  uploadProfilePhoto.single("photo"),
  async (req, res) => {
    const username = req.params.username;
    if (!requireSameUser(req, res, username)) return;

    if (!req.file) return res.status(400).json({ message: "Photo file is required" });

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
    } catch {
      res.status(500).json({ message: "Failed to upload profile photo" });
    }
  }
);

app.post("/message", requireAuth, async (req, res) => {
  const { sender, receiver, message } = req.body || {};

  if (!sender || !receiver || !message || !String(message).trim()) {
    return res.status(400).json({ message: "sender, receiver and message are required" });
  }

  if (!requireSameUser(req, res, sender)) return;

  try {
    const insertResult = await runQuery(
      "INSERT INTO messages (sender,receiver,message,status) VALUES (?,?,?,'sent')",
      [sender, receiver, String(message).trim()]
    );

    await runQuery(
      `
        INSERT INTO contacts (user1,user2)
        SELECT ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM contacts
          WHERE (user1=? AND user2=?)
          OR (user1=? AND user2=?)
        )
      `,
      [sender, receiver, sender, receiver, receiver, sender]
    );

    const messagePayload = {
      id: insertResult.insertId,
      sender,
      receiver,
      message: String(message).trim(),
      status: "sent",
      created_at: new Date(),
    };

    emitToUser(receiver, "receiveMessage", messagePayload);
    emitToUser(sender, "receiveMessage", messagePayload);

    res.json({ message: "Saved", data: messagePayload });
  } catch {
    res.status(500).json({ message: "Failed to save message" });
  }
});

app.get("/messages/:u1/:u2", requireAuth, async (req, res) => {
  const { u1, u2 } = req.params;
  if (!requireSameUser(req, res, u1)) return;

  try {
    const result = await runQuery(
      `SELECT * FROM messages
       WHERE (sender=? AND receiver=?)
       OR (sender=? AND receiver=?)
       ORDER BY created_at`,
      [u1, u2, u2, u1]
    );

    res.json(result);
  } catch {
    res.status(500).json({ message: "Failed to load messages" });
  }
});

app.get("/last-messages/:user", requireAuth, async (req, res) => {
  const user = req.params.user;
  if (!requireSameUser(req, res, user)) return;

  try {
    const result = await runQuery(
      `SELECT * FROM messages
       WHERE sender=? OR receiver=?
       ORDER BY created_at DESC`,
      [user, user]
    );

    const map = {};

    result.forEach((msg) => {
      const other = msg.sender === user ? msg.receiver : msg.sender;
      if (!map[other]) map[other] = msg;
    });

    res.json(Object.values(map));
  } catch {
    res.status(500).json({ message: "Failed to load last messages" });
  }
});

app.get("/search/:username", requireAuth, async (req, res) => {
  const search = `%${req.params.username}%`;

  try {
    const result = await runQuery(
      `
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
      `,
      [search]
    );

    res.json(result);
  } catch {
    res.status(500).json({ message: "Failed to search users" });
  }
});

app.get("/contacts/:username", requireAuth, async (req, res) => {
  const username = req.params.username;
  if (!requireSameUser(req, res, username)) return;

  try {
    const result = await runQuery(
      `
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
      `,
      [username, username, username, username, username]
    );

    res.json(result);
  } catch {
    res.status(500).json({ message: "Failed to load contacts" });
  }
});

app.post("/upload", requireAuth, uploadChatFile.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "File is required" });

  res.json({
    file: req.file.filename,
  });
});

app.post("/statuses", requireAuth, uploadStatusMedia.single("media"), async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const text = String(req.body?.text || "").trim();
  const privacy = String(req.body?.privacy || "contacts");

  if (!username) return res.status(400).json({ message: "Username is required" });
  if (!requireSameUser(req, res, username)) return;

  const mediaUrl = req.file ? `uploads/${req.file.filename}` : null;
  const mediaType = req.file
    ? req.file.mimetype.startsWith("image/")
      ? "image"
      : "file"
    : "text";

  if (!text && !mediaUrl) {
    return res.status(400).json({ message: "Status text or media is required" });
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
  } catch {
    res.status(500).json({ message: "Failed to post status" });
  }
});

app.get("/statuses/:username", requireAuth, async (req, res) => {
  const { username } = req.params;
  if (!requireSameUser(req, res, username)) return;

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
  } catch {
    res.status(500).json({ message: "Failed to load statuses" });
  }
});

app.get("/statuses-feed/:username", requireAuth, async (req, res) => {
  const username = req.params.username;
  if (!requireSameUser(req, res, username)) return;

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
  } catch {
    res.status(500).json({ message: "Failed to load status feed" });
  }
});

app.get("/calls/:username", requireAuth, async (req, res) => {
  const username = req.params.username;
  if (!requireSameUser(req, res, username)) return;

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
  } catch {
    res.status(500).json({ message: "Failed to load call history" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
