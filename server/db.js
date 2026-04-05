const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root123",
    database: "chat_app"
});

db.connect((err) => {
    if (err) {
        console.error("DB Error:", err);
        return;
    }
    console.log("MySQL Connected ✅");
});

module.exports = db;