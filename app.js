/**
 * app.js — Kết nối giao diện với engine DSS.
 * Luồng: nhập nhu cầu -> lọc sân -> AHP (trọng số) -> TOPSIS (xếp hạng) -> render.
 */

// ---- State trọng số hiện tại (giá trị thô do slider nhập, sẽ được chuẩn hóa) ----
const rawWeights = { ...DEFAULT_WEIGHTS };

// Các preset kịch bản (giá trị thô, sẽ chuẩn hóa về 100%)
const PRESETS = {
  balanced: { price: 20, distance: 20, rating: 25, quality: 25, facilities: 10 },
  price: { price: 50, distance: 20, rating: 15, quality: 10, facilities: 5 },
  quality: { price: 10, distance: 10, rating: 30, quality: 40, facilities: 10 },
  distance: { price: 15, distance: 50, rating: 15, quality: 15, facilities: 5 },
};

// ---- Tiện ích format ----
const fmtVND = (n) => n.toLocaleString("vi-VN") + "đ";
const fmtNum = (n, d = 3) => Number(n).toFixed(d);
const $ = (id) => document.getElementById(id);

/* ============================================================
 * Khởi tạo giao diện
 * ============================================================ */
function initTimeSelects() {
  const from = $("timeFrom");
  const to = $("timeTo");
  for (let h = 5; h <= 24; h++) {
    const label = (h === 24 ? "24:00" : String(h).padStart(2, "0") + ":00");
    from.insertAdjacentHTML("beforeend", `<option value="${h}">${label}</option>`);
    to.insertAdjacentHTML("beforeend", `<option value="${h}">${label}</option>`);
  }
  from.value = 18;
  to.value = 20;
}

function initDate() {
  // Mặc định hôm nay (theo máy người dùng)
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  $("playDate").value = iso;
  $("playDate").min = iso;
}

function renderWeightSliders() {
  const box = $("weights");
  box.innerHTML = "";
  CRITERIA.forEach((c) => {
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="weight-item">
        <div class="weight-head">
          <span class="w-label">${c.label}</span>
          <span class="w-val" id="wval-${c.key}">0%</span>
        </div>
        <input type="range" min="0" max="60" step="1" value="${rawWeights[c.key]}"
               id="wslider-${c.key}" data-key="${c.key}" />
      </div>`
    );
  });
  CRITERIA.forEach((c) => {
    $(`wslider-${c.key}`).addEventListener("input", (e) => {
      rawWeights[c.key] = Number(e.target.value);
      updateWeightDisplay();
      clearActivePreset();
    });
  });
  updateWeightDisplay();
}

/** Cập nhật % chuẩn hóa hiển thị bên cạnh mỗi slider. */
function updateWeightDisplay() {
  const norm = ahpFromPercents(rawWeights, CRITERIA); // tổng = 1
  CRITERIA.forEach((c) => {
    $(`wval-${c.key}`).textContent = Math.round(norm[c.key] * 100) + "%";
  });
  $("weightTotal").textContent = "100%";
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.keys(p).forEach((k) => {
    rawWeights[k] = p[k];
    const slider = $(`wslider-${k}`);
    if (slider) slider.value = p[k];
  });
  updateWeightDisplay();
  document.querySelectorAll(".chip").forEach((ch) => ch.classList.remove("active"));
  document.querySelector(`.chip[data-preset="${name}"]`)?.classList.add("active");
}

function clearActivePreset() {
  document.querySelectorAll(".chip").forEach((ch) => ch.classList.remove("active"));
}

/* ============================================================
 * Lọc sân theo nhu cầu (ràng buộc cứng trước khi xếp hạng)
 * ============================================================ */
function filterCourts(need) {
  return COURTS.filter((court) => {
    if (court.price > need.budget) return false;
    if (court.distance > need.maxDistance) return false;
    // Sân phải mở cửa bao trùm khung giờ chơi
    if (!(court.openFrom <= need.timeFrom && court.openTo >= need.timeTo)) return false;
    return true;
  });
}

/* ============================================================
 * Chạy DSS và render
 * ============================================================ */
let lastRanked = []; // lưu kết quả để mở modal chi tiết
let lastWeights = {};

function runDSS() {
  const need = {
    date: $("playDate").value,
    timeFrom: Number($("timeFrom").value),
    timeTo: Number($("timeTo").value),
    budget: Number($("budget").value),
    maxDistance: Number($("maxDistance").value),
  };

  if (need.timeTo <= need.timeFrom) {
    showMeta('⚠️ "Đến giờ" phải lớn hơn "Từ giờ". Vui lòng chọn lại khung giờ.', true);
    $("podium").hidden = true;
    $("results").innerHTML = "";
    $("emptyState").hidden = false;
    return;
  }

  const weights = ahpFromPercents(rawWeights, CRITERIA); // AHP -> trọng số chuẩn hóa
  lastWeights = weights;

  const candidates = filterCourts(need);

  if (candidates.length === 0) {
    $("podium").hidden = true;
    $("results").innerHTML = "";
    $("emptyState").hidden = false;
    $("emptyState").innerHTML =
      "<p>😕 Không có sân nào thỏa điều kiện. Thử nới ngân sách, tăng khoảng cách hoặc đổi khung giờ.</p>";
    showMeta(
      `Ngày ${formatDate(need.date)} · ${pad(need.timeFrom)}–${pad(need.timeTo)} · ` +
      `ngân sách ≤ ${fmtVND(need.budget)} · ≤ ${need.maxDistance} km`
    );
    return;
  }

  const ranked = topsis(candidates, CRITERIA, weights); // TOPSIS -> xếp hạng
  lastRanked = ranked;

  showMeta(
    `Tìm thấy <strong>${ranked.length}</strong> sân phù hợp · Ngày ${formatDate(need.date)} · ` +
    `${pad(need.timeFrom)}–${pad(need.timeTo)} · ngân sách ≤ ${fmtVND(need.budget)} · ≤ ${need.maxDistance} km`
  );
  renderPodium(ranked);
  renderResults(ranked);
}

/* ============================================================
 * Render kết quả
 * ============================================================ */
function showMeta(html, isWarn = false) {
  const el = $("resultMeta");
  el.innerHTML = html;
  el.style.color = isWarn ? "#b45309" : "";
}

function renderPodium(ranked) {
  const podium = $("podium");
  const top = ranked.slice(0, 3);
  if (top.length === 0) {
    podium.hidden = true;
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const maxScore = ranked[0].score || 1;
  podium.innerHTML = top
    .map(
      (c, i) => `
      <div class="podium-card p${i + 1}">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-name">${c.name}</div>
        <div class="podium-score">Điểm TOPSIS: ${fmtNum(c.score)}</div>
        <div class="podium-bar"><span style="width:${(c.score / maxScore) * 100}%"></span></div>
      </div>`
    )
    .join("");
  podium.hidden = false;
}

function renderResults(ranked) {
  $("emptyState").hidden = true;
  const list = $("results");

  list.innerHTML = ranked
    .map((c, idx) => {
      const isTop = idx === 0;
      const tags = [
        `<span class="tag">${fmtVND(c.price)}/giờ</span>`,
        `<span class="tag">${c.distance} km</span>`,
        `<span class="tag good">★ ${c.rating}</span>`,
        `<span class="tag">Chất lượng ${c.quality}/10</span>`,
        `<span class="tag">${c.facilities} tiện ích</span>`,
      ].join("");

      return `
      <div class="result-card ${isTop ? "top" : ""}">
        <div class="rank-badge">${c.rank}</div>
        <div class="court-info">
          <div class="court-name">${c.name}</div>
          <div class="court-sub">${c.address} · ${c.district}</div>
          <div class="court-tags">${tags}</div>
        </div>
        <div class="score-box">
          <div class="score-num">${fmtNum(c.score)}</div>
          <div class="score-label">điểm TOPSIS</div>
        </div>
        <div class="card-actions">
          <button type="button" class="link-btn" data-detail="${c.id}">📊 Xem cách tính</button>
          <a class="link-btn primary" href="${c.url}" target="_blank" rel="noopener">Đặt sân trên ALO Booking ↗</a>
        </div>
      </div>`;
    })
    .join("");

  // Gắn sự kiện cho nút "Xem cách tính"
  list.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => openDetail(btn.getAttribute("data-detail")));
  });
}

/* ============================================================
 * Modal chi tiết cách tính điểm TOPSIS
 * ============================================================ */
function openDetail(courtId) {
  const court = lastRanked.find((c) => c.id === courtId);
  if (!court) return;

  const rows = CRITERIA.map((c) => {
    const w = lastWeights[c.key];
    return `<tr>
      <td>${c.label}</td>
      <td class="num">${c.key === "price" ? fmtVND(court[c.key]) : court[c.key]}${c.unit && c.key !== "price" ? " " + c.unit : ""}</td>
      <td class="num">${c.type === "benefit" ? "Lợi ích ↑" : "Chi phí ↓"}</td>
      <td class="num">${Math.round(w * 100)}%</td>
    </tr>`;
  }).join("");

  $("modalContent").innerHTML = `
    <h3>${court.name}</h3>
    <p class="hint">${court.address} · ${court.district} · Hạng #${court.rank}</p>
    <table>
      <thead><tr><th>Tiêu chí</th><th class="num">Giá trị</th><th class="num">Loại</th><th class="num">Trọng số (AHP)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="formula">
      <strong>Điểm TOPSIS = D⁻ / (D⁺ + D⁻)</strong><br/>
      D⁺ (khoảng cách tới giải pháp lý tưởng tốt nhất) = <strong>${fmtNum(court._distBest, 4)}</strong><br/>
      D⁻ (khoảng cách tới giải pháp lý tưởng xấu nhất) = <strong>${fmtNum(court._distWorst, 4)}</strong><br/>
      ⇒ Điểm = ${fmtNum(court._distWorst, 4)} / (${fmtNum(court._distBest, 4)} + ${fmtNum(court._distWorst, 4)}) =
      <strong>${fmtNum(court.score)}</strong>
      <br/><br/>
      Điểm càng gần <strong>1</strong> nghĩa là sân càng gần giải pháp lý tưởng ⇒ càng phù hợp.
    </div>`;
  $("detailModal").hidden = false;
}

function closeDetail() {
  $("detailModal").hidden = true;
}

/* ============================================================
 * Helpers định dạng
 * ============================================================ */
function pad(h) {
  return (h === 24 ? "24" : String(h).padStart(2, "0")) + ":00";
}
function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/* ============================================================
 * Wire up
 * ============================================================ */
function init() {
  initTimeSelects();
  initDate();
  renderWeightSliders();

  // Sliders nhu cầu
  $("budget").addEventListener("input", (e) => {
    $("budgetVal").textContent = fmtVND(Number(e.target.value));
  });
  $("maxDistance").addEventListener("input", (e) => {
    $("maxDistanceVal").textContent = e.target.value;
  });

  // Presets
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => applyPreset(chip.getAttribute("data-preset")));
  });

  // Nút tìm
  $("findBtn").addEventListener("click", runDSS);

  // Modal
  $("closeModal").addEventListener("click", closeDetail);
  $("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });

  // Preset mặc định
  applyPreset("balanced");
}

document.addEventListener("DOMContentLoaded", init);
