// ===========================
// script.js für Zeiterfassung
// ===========================

const loginSection = document.getElementById("user-prompt");
const appSection = document.querySelector(".container");
const loginInput = document.getElementById("user-id");
const loginButton = document.getElementById("user-login");
const welcomeMessage = document.getElementById("welcome-message");
const statusMessage = document.getElementById("status-message");

const checkInBtn = document.getElementById("btn-check-in");
const checkOutBtn = document.getElementById("btn-check-out");
const startBreakBtn = document.getElementById("btn-start-break");
const endBreakBtn = document.getElementById("btn-end-break");

const workTimerEl = document.getElementById("work-timer");
const pauseTimerEl = document.getElementById("pause-timer");

const manualForm = document.getElementById("manual-form");

const WEBHOOK_URL = "<Dein Zeiterfassung Webhook URL bei n8n>";
const CHECK_URL = "<Dein Mitarbeitercheckin Webhook URL bei n8n>";

let workStart = null;        // ms
let pauseStart = null;       // ms
let totalPauseMs = 0;        // ms
let workTimerInterval = null;
let pauseTimerInterval = null;

// --------- Helpers (Sekunden-genau) ---------
const fmtHHMMSS = (d) =>
  d.toLocaleTimeString("de-DE", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const ensureHHMMSS = (t) => {
  // Normalisiert Eingaben auf "HH:MM:SS"
  if (!t) return "00:00:00";
  const s = t.toString().trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}$/.test(s)) return s + ":00";
  if (/^\d{1,2}$/.test(s)) return `00:${s.padStart(2, "0")}:00`;
  return "00:00:00";
};

const msToHHMMSS = (ms) => {
  let sec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

function formatDuration(ms) {
  return msToHHMMSS(ms);
}

// --------- Timer Updates ---------
function updateWorkTimer() {
  const now = Date.now();
  const elapsed = now - workStart - totalPauseMs;
  workTimerEl.textContent = formatDuration(elapsed);
}

function updatePauseTimer() {
  const now = Date.now();
  const elapsed = now - pauseStart;
  pauseTimerEl.textContent = formatDuration(elapsed);
}

// ========== LOGIN ==========
loginButton.addEventListener("click", async () => {
  const id = loginInput.value.trim();
  if (!id) return;

  try {
    const res = await fetch(CHECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();

    if (data.exists) {
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: data.matchId,
          vorname: data.vorname,
          nachname: data.nachname,
        })
      );

      if (welcomeMessage) {
        welcomeMessage.textContent = `Eingeloggt als: ${data.vorname} ${data.nachname}`;
      }
      loginSection.style.display = "none";
      appSection.style.display = "block";

      restoreTimerState();
    } else {
      statusMessage.textContent = "❌ Mitarbeiter-ID nicht gefunden.";
    }
  } catch (e) {
    console.error(e);
    statusMessage.textContent = "⚠️ Login fehlgeschlagen (Netzwerk).";
  }
});

// ========== CHECK-IN ==========
checkInBtn.addEventListener("click", () => {
  workStart = Date.now();
  totalPauseMs = 0;
  localStorage.setItem("workStart", workStart.toString());
  localStorage.setItem("pauseTotal", totalPauseMs.toString());

  workTimerInterval = setInterval(updateWorkTimer, 1000);

  checkInBtn.disabled = true;
  checkOutBtn.disabled = false;
  startBreakBtn.disabled = false;
  endBreakBtn.disabled = true;
});

// ========== CHECK-OUT ==========
checkOutBtn.addEventListener("click", async () => {
  clearInterval(workTimerInterval);
  clearInterval(pauseTimerInterval);

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const endTime = Date.now();
  const startTime = parseInt(localStorage.getItem("workStart") || "0", 10);
  let pauseMs = parseInt(localStorage.getItem("pauseTotal") || "0", 10);

  // Zeiten als HH:MM:SS
  const startStr = fmtHHMMSS(new Date(startTime));
  const endStr   = fmtHHMMSS(new Date(endTime));

  // Pausen/Arbeitszeit in Sekunden berechnen
  const pauseSecRaw = Math.floor(pauseMs / 1000);
  const diffSec     = Math.max(0, Math.floor((endTime - startTime) / 1000));
  let   pauseSec    = pauseSecRaw;

  // Mindestpausen-Logik:
  // > 6h bis ≤ 9h -> 30 Minuten, > 9h -> 45 Minuten
  const requiredPauseSec =
    diffSec > 9 * 3600 ? 45 * 60 :
    diffSec > 6 * 3600 ? 30 * 60 : 0;

  // Falls zu wenig Pause gestempelt wurde, auf Mindestpause auffüllen
  if (pauseSec < requiredPauseSec) {
    pauseSec = requiredPauseSec;
  }

  const payload = {
    date: new Date(startTime).toISOString().split("T")[0],
    start: startStr,                         // HH:MM:SS
    end:   endStr,                           // HH:MM:SS
    pause: msToHHMMSS(pauseSec * 1000),      // HH:MM:SS
    description: "",
    id: user.id,
    vorname: user.vorname,
    nachname: user.nachname,
  };

  try {
    await fetch(WEBHOOK_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    statusMessage.textContent = "✅ Zeiterfassung gesendet.";
  } catch (e) {
    console.error(e);
    statusMessage.textContent = "⚠️ Senden fehlgeschlagen.";
  } finally {
    resetTimers();
  }
});


// ========== PAUSE START ==========
startBreakBtn.addEventListener("click", () => {
  clearInterval(workTimerInterval);
  pauseStart = Date.now();
  pauseTimerInterval = setInterval(updatePauseTimer, 1000);

  startBreakBtn.disabled = true;
  endBreakBtn.disabled = false;
});

// ========== PAUSE ENDE ==========
endBreakBtn.addEventListener("click", () => {
  clearInterval(pauseTimerInterval);
  const duration = Date.now() - pauseStart;
  totalPauseMs += duration;
  localStorage.setItem("pauseTotal", totalPauseMs.toString());
  pauseStart = null;

  pauseTimerEl.textContent = "00:00:00";
  workTimerInterval = setInterval(updateWorkTimer, 1000);

  endBreakBtn.disabled = true;
  startBreakBtn.disabled = false;
});

// ========== RESET ==========
function resetTimers() {
  clearInterval(workTimerInterval);
  clearInterval(pauseTimerInterval);
  workStart = null;
  pauseStart = null;
  totalPauseMs = 0;
  workTimerEl.textContent = "00:00:00";
  pauseTimerEl.textContent = "00:00:00";
  localStorage.removeItem("workStart");
  localStorage.removeItem("pauseTotal");

  checkInBtn.disabled = false;
  checkOutBtn.disabled = true;
  startBreakBtn.disabled = true;
  endBreakBtn.disabled = true;
}

// ========== RESTORE BEI NEULADEN ==========
function restoreTimerState() {
  const start = parseInt(localStorage.getItem("workStart") || "0", 10);
  const pause = parseInt(localStorage.getItem("pauseTotal") || "0", 10) || 0;
  if (start) {
    workStart = start;
    totalPauseMs = pause;
    workTimerInterval = setInterval(updateWorkTimer, 1000);
    checkInBtn.disabled = true;
    checkOutBtn.disabled = false;
    startBreakBtn.disabled = false;
    endBreakBtn.disabled = true;
  }
}

// ========== MANUELLE ERFASSUNG ==========
manualForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  // Times sicher auf HH:MM:SS normalisieren
  const start = ensureHHMMSS(manualForm.start.value);
  const end = ensureHHMMSS(manualForm.end.value);
  const pause = ensureHHMMSS(manualForm.pause.value || "00:00:00");

  const payload = {
    date: manualForm.date.value,
    start,
    end,
    pause,
    description: manualForm.note.value || "",
    id: user.id,
    vorname: user.vorname,
    nachname: user.nachname,
  };

  try {
    await fetch(WEBHOOK_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    statusMessage.textContent = "📝 Manuelle Zeit wurde gespeichert.";
    manualForm.reset();
  } catch (e) {
    console.error(e);
    statusMessage.textContent = "⚠️ Speichern fehlgeschlagen.";
  }
});

// INIT
appSection.style.display = "none";
loginSection.style.display = "block";
