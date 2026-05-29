const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// =====================
// ROOM MEMORY
// =====================
const rooms = {};

const crypto = require("crypto");

function getRoom(roomId) {
  if (!roomId) return null;

  if (!rooms[roomId]) {
    rooms[roomId] = {};
  }

  // pastikan struktur selalu ada
  if (!Array.isArray(rooms[roomId].presentations)) {
    rooms[roomId].presentations = [];
  }

  if (!rooms[roomId].activePresentation) {
    rooms[roomId].activePresentation = null;
  }

  if (!rooms[roomId].users) {
    rooms[roomId].users = 0;
  }

  if (!rooms[roomId].lastActivity) {
    rooms[roomId].lastActivity = Date.now();
  }

  if (!rooms[roomId].status) {
    rooms[roomId].status = "live";
  }

  return rooms[roomId];
}

function updateRoomStatus(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.status = room.users > 0 ? "live" : "idle";
}

// =====================
// MIDDLEWARE (HARUS DI ATAS ROUTES)
// =====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

app.post("/create-room", (req, res) => {

  let roomId = req.body.roomId;

  // =========================
  // AUTO GENERATE
  // =========================
  if (!roomId || roomId.trim() === "") {

    do {
      roomId = crypto.randomBytes(3).toString("hex");
    } while (rooms[roomId]); // pastikan unik

  } else {

    // =========================
    // CUSTOM ROOM
    // =========================
    roomId = roomId.trim();

    if (rooms[roomId]) {
      return res.status(409).json({
        error: "Room sudah digunakan. Gunakan ID lain."
      });
    }
  }

  // =========================
  // BUAT ROOM BARU
  // =========================
  rooms[roomId] = {
    activeFile: null,
    page: 1,
    lastActivity: Date.now(),
    users: 0,
	settings: {
	  reactionEnabled: true
	}
  };

  res.json({ roomId });

});

app.get("/presen/:roomId", (req, res) => {
  res.sendFile(__dirname + "/public/presen.html");
});

app.get("/reaksi/:roomId", (req, res) => {
  res.sendFile(__dirname + "/public/reaksi.html");
});
app.get("/admin/rooms", (req, res) => {
  res.json(rooms);
});
app.get("/view/:roomId", (req, res) => {
  res.sendFile(__dirname + "/public/view.html");
});


// =====================
// STORAGE UPLOAD
// =====================
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, Date.now() + "-" + safeName);
  }
});

const upload = multer({ storage });

// =====================
// UPLOAD FILE
// =====================
app.post("/upload", upload.single("pdf"), (req, res) => {

  const roomId = req.body.roomId;

  if (!roomId) {
    return res.status(400).json({ error: "roomId missing" });
  }

  const room = getRoom(roomId);

  if (!room) {
    return res.status(400).json({ error: "room not found" });
  }

  if (!Array.isArray(room.presentations)) {
    room.presentations = [];
  }

  if (!req.file) {
    return res.status(400).json({ error: "file missing" });
  }

  const file = {
    name: req.file.originalname,
    path: req.file.filename
  };

  room.presentations.push(file);

  if (!room.activePresentation) {
    room.activePresentation = file;
  }

  io.to(roomId).emit("update-list", room.presentations);
  io.to(roomId).emit("set-active", room.activePresentation);

  res.status(200).json({
	  success: true,
	  file
	});
});

// =====================
// SELECT FILE
// =====================
app.post("/select", (req, res) => {
  const { roomId, path: filePath } = req.body;

  const room = getRoom(roomId);

  const file = room.presentations.find(p => p.path === filePath);

  if (file) {
    room.activePresentation = file;
    io.to(roomId).emit("set-active", file);
  }

  res.json({ ok: true });
});

// =====================
// DELETE FILE
// =====================
app.post("/delete", (req, res) => {

  const { roomId, path: filePath } = req.body;

  const room = getRoom(roomId);

  if (!room) return res.status(400).json({ error: "room not found" });
  
  if (!Array.isArray(room.presentations)) {
    room.presentations = [];
  }

  // hapus file fisik
  const fullPath = path.join(__dirname, "uploads", filePath);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  // hapus dari list
  room.presentations =
    room.presentations.filter(p => p.path !== filePath);

  // reset active jika perlu
  if (room.activePresentation?.path === filePath) {
    room.activePresentation = null;

    // kalau masih ada file lain, set otomatis
    if (room.presentations.length > 0) {
      room.activePresentation = room.presentations[0];
      io.to(roomId).emit("set-active", room.activePresentation);
    }
  }

  io.to(roomId).emit("update-list", room.presentations);

  res.json({ ok: true });
});

// =====================
// SOCKET.IO
// =====================
io.on("connection", (socket) => {
  
  socket.on("join-room", (roomId) => {

	  if (!rooms[roomId]) {
		socket.emit("room-error", "Room tidak ada");
		return;
	  }

	  // simpan room di socket
	  socket.join(roomId);
	  socket.roomId = roomId;

	  const room = rooms[roomId];

	  // hitung ulang user berdasarkan socket aktif
	  room.users = io.sockets.adapter.rooms.get(roomId)?.size || 0;

	  room.lastActivity = Date.now();

	  socket.emit("update-list", room.presentations || []);

	  if (room.activePresentation) {
		socket.emit("set-active", room.activePresentation);
	  }

	});
  
  socket.on("disconnect", () => {
	  const roomId = socket.roomId;

	  if (roomId && rooms[roomId]) {
		rooms[roomId].users--;
		rooms[roomId].lastActivity = Date.now();
	  }
	});

  socket.on("reaction", (emoji) => {

	  if (!socket.roomId) return;

	  const room = rooms[socket.roomId];
	  if (!room) return;

	  // 🔥 cek apakah reaction diizinkan
	  if (!room.settings?.reactionEnabled) return;

	  io.to(socket.roomId).emit("show-reaction", emoji);

	});
  
  socket.on("change-page", (data) => {
	  io.to(data.roomId).emit("update-page", data.page);
	});
	
  socket.on("toggle-reaction", ({ roomId, enabled }) => {

	  const room = rooms[roomId];
	  if (!room) return;

	  if (!room.settings) {
		room.settings = {};
	  }

	  room.settings.reactionEnabled = enabled;

	  io.to(roomId).emit(
		"reaction-mode",
		enabled
	  );

	});
	
	socket.on("toggle-qr", ({ roomId, enabled }) => {

	  const room = rooms[roomId];
	  if (!room) return;

	  if (!room.settings) {
		room.settings = {};
	  }

	  room.settings.showQR = enabled;

	  io.to(roomId).emit("qr-mode", enabled);

	});

});

// =====================
// AUTO CLEANUP ROOM
// =====================
setInterval(() => {

  const now = Date.now();

  for (const roomId in rooms) {

    const room = rooms[roomId];

    // hitung user real-time dari socket
    const userCount =
      io.sockets.adapter.rooms.get(roomId)?.size || 0;

    room.users = userCount;

    // kalau 30 menit tidak aktif DAN tidak ada user
    if (
      now - room.lastActivity > 30 * 60 * 1000 &&
      userCount === 0
    ) {

      console.log("🧹 Room expired:", roomId);

      // optional: hapus file fisik juga
      if (room.presentations) {
        room.presentations.forEach(file => {
          const fullPath = path.join(__dirname, "uploads", file.path);

          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        });
      }

      delete rooms[roomId];
    }
  }

}, 60 * 1000); // cek tiap 1 menit

// =====================
// START SERVER
// =====================
const PORT = 9090;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});

app.get("/check-room/:roomId", (req, res) => {
  const roomId = req.params.roomId;

  if (rooms[roomId]) {
    return res.json({ exists: true });
  }

  res.json({ exists: false });
});
