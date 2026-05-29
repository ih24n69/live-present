const socket = io();

const roomId = window.location.pathname.split("/")[2];
socket.emit("join-room", roomId);
const audienceReact =
  window.location.origin + "/reaksi/" + roomId;
const audienceView =
  window.location.origin + "/view/" + roomId; 

let pdfDoc = null;
let pageNum = 1;
let currentActive = null;
let currentMode = null;

const canvas = document.getElementById("pdf");
const ctx = canvas.getContext("2d");

// ===== Reaction =====
socket.on("show-reaction", (emoji) => {
  const el = document.createElement("div");
  el.className = "emoji";
  el.innerText = emoji;

  const side = Math.random() < 0.5 ? "left" : "right";

  if (side === "left") {
    el.style.left = Math.random() * 20 + "vw";   // kiri saja
  } else {
    el.style.left = (80 + Math.random() * 20) + "vw"; // kanan saja
  }

  // vertikal tetap random sedikit biar natural
  el.style.bottom = Math.random() * 30 + "px";

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 2500);
});

// ===== Load PDF =====
async function loadPDF(url) {
  console.log("Loading PDF:", url);

  try {
    const loadingTask = pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise;

    pageNum = 1; // 🔥 WAJIB RESET STATE

    console.log("PDF loaded pages:", pdfDoc.numPages);

    renderPage(pageNum);

  } catch (e) {
    console.error("PDF ERROR:", e);
  }
}

// ===== Render Page =====
function renderPage(num) {
  if (!pdfDoc) return;

  pageNum = num; // 🔥 SYNC STATE

  pdfDoc.getPage(num).then(page => {
    const viewport = page.getViewport({ scale: 1.5 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    page.render({
      canvasContext: ctx,
      viewport: viewport
    });
  });
}

// ===== Navigation =====
function nextPage() {
  if (!pdfDoc) return;

  if (pageNum < pdfDoc.numPages) {
    renderPage(pageNum + 1);
  }
  socket.emit("change-page", {
	  roomId: roomId,
	  page: pageNum
	});
}

function prevPage() {
  if (!pdfDoc) return;

  if (pageNum > 1) {
    renderPage(pageNum - 1);
  }
  socket.emit("change-page", {
	  roomId: roomId,
	  page: pageNum
	});
}

function clearViewer() {
  const viewer = document.getElementById("viewer");
  viewer.innerHTML = "";

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  pdfDoc = null;
}

// ===== Active file from server =====
socket.on("set-active", async (item) => {
  currentActive = item;
  currentMode = item.type;

  loadPDF("/uploads/" + item.path);  // 🔥 pakai item.path

  renderList();
});

socket.on("update-list", (list) => {

  if (!Array.isArray(list)) return;

  fileList = list;   // simpan
  renderList();      // render ulang

});

function renderList() {

  const container = document.getElementById("list");
  container.innerHTML = "";

  if (!fileList || fileList.length === 0) {
    clearViewer();
    return;
  }

  fileList.forEach(file => {

    const wrapper = document.createElement("div");
	wrapper.className = "file-item";

    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "space-between";
    wrapper.style.alignItems = "center";
    wrapper.style.padding = "8px";
    wrapper.style.marginTop = "5px";
    wrapper.style.background = "#333";
    wrapper.style.borderRadius = "6px";

    // 🔥 HIGHLIGHT ACTIVE
    if (currentActive && currentActive.path === file.path) {
      wrapper.style.background = "#1e90ff";
      wrapper.style.boxShadow = "0 0 8px #1e90ff";
    }

    const btn = document.createElement("div");
	btn.className = "file-name";
    btn.innerText = file.name;
    btn.style.cursor = "pointer";
    btn.style.flex = "1";

    btn.onclick = () => {
      fetch("/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: roomId,
          path: file.path
        })
      });
    };
	// DELETE BUTTON
    const del = document.createElement("div");
	del.className = "file-delete";
	del.innerText = "✖";
    del.style.color = "red";
    del.style.cursor = "pointer";
    del.style.marginLeft = "10px";

    del.onclick = async (e) => {
	  e.stopPropagation();

	  const result = await Swal.fire({
		title: "Hapus file ini?",
		text: file.name,
		icon: "warning",

		showCancelButton: true,
		confirmButtonText: "Ya",
		cancelButtonText: "Batal",

		customClass: {
		  confirmButton: "btn-confirm",
		  cancelButton: "btn-cancel"
		},

		buttonsStyling: false,
	  });

	  if (result.isConfirmed) {
		await fetch("/delete", {
		  method: "POST",
		  headers: {
			"Content-Type": "application/json"
		  },
		  body: JSON.stringify({
			roomId: roomId,
			path: file.path
		  })
		});

		showToast("success", "File dihapus");
	  }
	};
	
    wrapper.appendChild(btn);
	wrapper.appendChild(del);
    container.appendChild(wrapper);
  });
}

document.querySelector(".main").addEventListener("click", (e) => {
  const width = window.innerWidth;
  const x = e.clientX;

  if (x > width / 2) {
    nextPage();   // kanan = next
  } else {
    prevPage();   // kiri = prev
  }
});

document.getElementById("uploadForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  formData.append("roomId", roomId);

  const box = document.getElementById("uploadBox");
  const progress = document.getElementById("uploadProgress");
  const text = document.getElementById("uploadText");

  // 🔥 SHOW ONLY WHEN UPLOADING
  box.style.display = "block";
  progress.value = 0;
  text.innerText = "0%";

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload", true);

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      const percent = Math.round((event.loaded / event.total) * 100);
      progress.value = percent;
      text.innerText = percent + "%";
    }
  };

  xhr.onload = function () {
    let res = {};
    try { res = JSON.parse(xhr.responseText); } catch (e) {}

    if (xhr.status === 200 && res.success) {

      showToast("success", "Upload berhasil");

      setTimeout(() => {
        box.style.display = "none";
      }, 500);

    } else {
      showToast("error", res.error || "Upload gagal");
      box.style.display = "none";
    }
  };

  xhr.onerror = function () {
    showToast("error", "Upload error");
    box.style.display = "none";
  };

  xhr.send(formData);
});

function toggleQR() {
  const box = document.getElementById("qrBox");

  if (box.style.display === "none") {
    box.style.display = "block";

    QRCode.toCanvas(
      document.getElementById("qr"),
      audienceReact,
      function (err) {
        if (err) console.error(err);
      }
    );

  } else {
    box.style.display = "none";
  }
}

function shareRoom() {

  navigator.clipboard.writeText(audienceReact)
    .then(() => {
      showToast("success", "Tautan disalin");
    })
    .catch(() => {
      showToast("error", "Gagal menyalin");
    });

}


function toggleQRView() {
  const box = document.getElementById("qrBoxView");

  if (box.style.display === "none") {
    box.style.display = "block";

    QRCode.toCanvas(
      document.getElementById("qrView"),
      audienceView,
      function (err) {
        if (err) console.error(err);
      }
    );

  } else {
    box.style.display = "none";
  }
}

function shareRoomView() {

  navigator.clipboard.writeText(audienceView)
    .then(() => {
      showToast("success", "Tautan disalin");
    })
    .catch(() => {
      showToast("error", "Gagal menyalin");
    });

}


function showToast(icon, title) {
  Swal.fire({
    toast: true,
    position: "top-end",
    icon,
    title,
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
  });
}

function toggleReaction() {

  const enabled =
    document.getElementById("toggleReaction").checked;

  socket.emit("toggle-reaction", {
    roomId,
    enabled
  });

}

const fileInput =
  document.getElementById("fileInput");

fileInput.addEventListener("change", () => {

  if (!fileInput.files.length) return;

  uploadFile(fileInput.files[0]);

});

async function uploadFile(file) {

  const uploadBox =
    document.getElementById("uploadBox");

  const progress =
    document.getElementById("uploadProgress");

  const text =
    document.getElementById("uploadText");

  uploadBox.style.display = "block";

  const formData = new FormData();
  formData.append("pdf", file);
  formData.append("roomId", roomId);

  const xhr = new XMLHttpRequest();

  xhr.open("POST", "/upload", true);

  xhr.upload.onprogress = (e) => {

    if (e.lengthComputable) {

      const percent =
        Math.round((e.loaded / e.total) * 100);

      progress.value = percent;
      text.innerText = percent + "%";

    }

  };

  xhr.onload = () => {

    uploadBox.style.display = "none";

    progress.value = 0;
    text.innerText = "0%";

    if (xhr.status === 200) {

      showToast("success", "Upload berhasil");

    } else {

      showToast("error", "Upload gagal");

    }

  };

  xhr.onerror = () => {

    uploadBox.style.display = "none";

    showToast("error", "Upload gagal");

  };

  xhr.send(formData);

}

function toggleQRViewer() {

  const enabled =
    document.getElementById("toggleQRViewer").checked;

  socket.emit("toggle-qr", {
    roomId,
    enabled
  });

}