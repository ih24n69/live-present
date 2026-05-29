const socket = io();
const roomId = window.location.pathname.split("/")[2];
socket.emit("join-room", roomId);

function react(emoji) {
  socket.emit("reaction", emoji);

  // 🔥 local feedback biar terasa klik
  const el = document.createElement("div");
  el.className = "pop";
  el.innerText = emoji;

  el.style.left = Math.random() * 90 + "vw";
  el.style.bottom = "20%";

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 3000);
}