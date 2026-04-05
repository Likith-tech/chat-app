const db = require("./db");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// NEW
const multer = require("multer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

let onlineUsers = [];


// ================= FILE UPLOAD =================

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// serve uploaded files
app.use("/uploads", express.static("uploads"));


// ================= SOCKET =================

io.on("connection", (socket) => {

  socket.on("join", (userData) => {

    onlineUsers = onlineUsers.filter(
      u => u.username !== userData.username
    );

    onlineUsers.push({
      id: socket.id,
      username: userData.username,
    });

    io.emit("onlineUsers", onlineUsers);

  });


  socket.on("typing", (username) => {
    socket.broadcast.emit("typing", username);
  });


  socket.on("stopTyping", () => {
    socket.broadcast.emit("stopTyping");
  });


  // ✅ FIXED MESSAGE TIME
  socket.on("sendMessage", (data) => {

    const messageWithTime = {
      ...data,
      created_at: new Date(),
      status: "sent"
    };

    const receiver = onlineUsers.find(
      u => u.username === data.receiver
    );

    if (receiver) {
      io.to(receiver.id).emit("receiveMessage", messageWithTime);
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


  socket.on("disconnect", () => {

    onlineUsers = onlineUsers.filter(
      u => u.id !== socket.id
    );

    io.emit("onlineUsers", onlineUsers);

  });

});


// ================= AUTH =================

app.post("/register", async (req, res) => {

  const { username, email, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users (username,email,password) VALUES (?,?,?)",
    [username, email, hashed],
    (err) => {

      if (err) return res.status(500).send(err);

      res.send("Registered");

    }
  );

});


app.post("/login", (req, res) => {

  const { email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email=?",
    [email],
    async (err, result) => {

      if (result.length === 0)
        return res.status(404).send("User not found");

      const user = result[0];

      const match = await bcrypt.compare(password, user.password);

      if (!match)
        return res.status(401).send("Wrong password");

      res.json({
        user: {
          username: user.username,
          email: user.email,
        },
      });

    }
  );

});


// ================= SEND MESSAGE =================

app.post("/message", (req, res) => {

  const { sender, receiver, message } = req.body;

  db.query(
    "INSERT INTO messages (sender,receiver,message,status) VALUES (?,?,?,'sent')",
    [sender, receiver, message],
    (err) => {

      if (err) return res.status(500).send(err);

      // 🔐 ADD CONTACT IF FIRST MESSAGE
      const contactQuery = `
        INSERT INTO contacts (user1,user2)
        SELECT ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM contacts
          WHERE (user1=? AND user2=?)
          OR (user1=? AND user2=?)
        )
      `;

      db.query(contactQuery, [
        sender, receiver,
        sender, receiver,
        receiver, sender
      ]);

      res.send("Saved");

    }
  );

});


// ================= GET PRIVATE CHAT =================

app.get("/messages/:u1/:u2", (req, res) => {

  const { u1, u2 } = req.params;

  db.query(
    `SELECT * FROM messages
     WHERE (sender=? AND receiver=?)
     OR (sender=? AND receiver=?)
     ORDER BY created_at`,
    [u1, u2, u2, u1],
    (err, result) => res.json(result)
  );

});


// ================= LAST MESSAGE =================

app.get("/last-messages/:user", (req, res) => {

  db.query(
    `SELECT * FROM messages
     WHERE sender=? OR receiver=?
     ORDER BY created_at DESC`,
    [req.params.user, req.params.user],
    (err, result) => {

      const map = {};

      result.forEach(msg => {

        const other =
          msg.sender === req.params.user
            ? msg.receiver
            : msg.sender;

        if (!map[other]) map[other] = msg;

      });

      res.json(Object.values(map));

    }
  );

});


// ================= SEARCH USERS =================

app.get("/search/:username", (req, res) => {

  const search = `%${req.params.username}%`;

  const query = `
    SELECT username, profile_pic
    FROM users
    WHERE username LIKE ?
  `;

  db.query(query, [search], (err, result) => {

    if (err) return res.status(500).send(err);

    res.json(result);

  });

});


// ================= CONTACT LIST =================

app.get("/contacts/:username", (req, res) => {

  const username = req.params.username;

  const query = `
    SELECT
      CASE
        WHEN user1=? THEN user2
        ELSE user1
      END AS contact
    FROM contacts
    WHERE user1=? OR user2=?
  `;

  db.query(query, [username, username, username], (err, result) => {

    if (err) return res.status(500).send(err);

    res.json(result);

  });

});


// ================= FILE UPLOAD API =================

app.post("/upload", upload.single("file"), (req, res) => {

  res.json({
    file: req.file.filename
  });

});


// ================= SERVER =================

server.listen(5000, () => {
  console.log("Server running 🚀");
});