/**
 * dss.js — Engine hỗ trợ quyết định: AHP (trọng số) + TOPSIS (xếp hạng).
 *
 * AHP  (Analytic Hierarchy Process): xác định trọng số các tiêu chí.
 * TOPSIS (Technique for Order Preference by Similarity to Ideal Solution):
 *        xếp hạng phương án dựa trên khoảng cách tới giải pháp lý tưởng.
 *
 * Toàn bộ chạy client-side, không phụ thuộc thư viện ngoài.
 */

/* ============================================================
 * AHP
 * ============================================================ */

/**
 * Random Index (RI) cho consistency ratio theo Saaty, tra theo số tiêu chí n.
 */
const AHP_RI = { 1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49 };

/**
 * AHP đơn giản: chuẩn hóa trọng số phần trăm do người dùng nhập thành tổng = 1.
 * @param {Object} weightPercents - { key: phần trăm }
 * @param {Array}  criteria - danh sách tiêu chí (dùng key)
 * @returns {Object} { key: trọng số chuẩn hóa (tổng = 1) }
 */
function ahpFromPercents(weightPercents, criteria) {
  const total = criteria.reduce((s, c) => s + (Number(weightPercents[c.key]) || 0), 0);
  const weights = {};
  criteria.forEach((c) => {
    weights[c.key] = total > 0 ? (Number(weightPercents[c.key]) || 0) / total : 1 / criteria.length;
  });
  return weights;
}

/**
 * AHP đầy đủ: tính trọng số từ ma trận so sánh cặp (pairwise comparison matrix)
 * bằng phương pháp trung bình cột chuẩn hóa (normalized column average),
 * đồng thời tính lambdaMax, CI và CR.
 *
 * @param {number[][]} matrix - ma trận vuông n×n, matrix[i][j] = mức độ quan
 *        trọng của tiêu chí i so với j (thang Saaty 1..9). matrix[j][i]=1/matrix[i][j].
 * @param {Array} criteria - danh sách tiêu chí (theo thứ tự hàng/cột của matrix)
 * @returns {{weights: Object, lambdaMax: number, ci: number, cr: number, consistent: boolean}}
 */
function ahpFromMatrix(matrix, criteria) {
  const n = matrix.length;

  // Tổng mỗi cột
  const colSums = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) colSums[j] += matrix[i][j];
  }

  // Ma trận chuẩn hóa + trọng số = trung bình hàng của ma trận chuẩn hóa
  const priorities = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) rowSum += matrix[i][j] / colSums[j];
    priorities[i] = rowSum / n;
  }

  // lambdaMax = trung bình của (Aw)_i / w_i
  let lambdaMax = 0;
  for (let i = 0; i < n; i++) {
    let aw = 0;
    for (let j = 0; j < n; j++) aw += matrix[i][j] * priorities[j];
    lambdaMax += aw / priorities[i];
  }
  lambdaMax /= n;

  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = AHP_RI[n] || 1.49;
  const cr = ri > 0 ? ci / ri : 0;

  const weights = {};
  criteria.forEach((c, i) => (weights[c.key] = priorities[i]));

  return { weights, lambdaMax, ci, cr, consistent: cr <= 0.1 };
}

/* ============================================================
 * TOPSIS
 * ============================================================ */

/**
 * Chạy TOPSIS trên danh sách phương án.
 *
 * @param {Array}  alternatives - danh sách sân (mỗi phần tử có các key tiêu chí)
 * @param {Array}  criteria - [{key, type: "benefit"|"cost"}]
 * @param {Object} weights - { key: trọng số (tổng = 1) }
 * @returns {Array} bản sao alternatives, mỗi phần tử thêm { score, rank },
 *                  sắp xếp theo score giảm dần.
 */
function topsis(alternatives, criteria, weights) {
  const m = alternatives.length;
  if (m === 0) return [];

  // 1. Ma trận quyết định
  const matrix = alternatives.map((alt) => criteria.map((c) => Number(alt[c.key])));

  // 2. Chuẩn hóa vector (vector normalization): chia cho căn tổng bình phương cột
  const denom = criteria.map((_, j) => {
    let sq = 0;
    for (let i = 0; i < m; i++) sq += matrix[i][j] ** 2;
    return Math.sqrt(sq) || 1; // tránh chia 0
  });
  const norm = matrix.map((row) => row.map((v, j) => v / denom[j]));

  // 3. Nhân trọng số
  const weighted = norm.map((row) =>
    row.map((v, j) => v * weights[criteria[j].key])
  );

  // 4. Xác định giải pháp lý tưởng dương (ideal best) và âm (ideal worst)
  const idealBest = criteria.map((c, j) => {
    const col = weighted.map((row) => row[j]);
    return c.type === "benefit" ? Math.max(...col) : Math.min(...col);
  });
  const idealWorst = criteria.map((c, j) => {
    const col = weighted.map((row) => row[j]);
    return c.type === "benefit" ? Math.min(...col) : Math.max(...col);
  });

  // 5. Khoảng cách tới lý tưởng dương/âm
  const results = alternatives.map((alt, i) => {
    let distBest = 0;
    let distWorst = 0;
    for (let j = 0; j < criteria.length; j++) {
      distBest += (weighted[i][j] - idealBest[j]) ** 2;
      distWorst += (weighted[i][j] - idealWorst[j]) ** 2;
    }
    distBest = Math.sqrt(distBest);
    distWorst = Math.sqrt(distWorst);

    // 6. Điểm TOPSIS (closeness coefficient)
    const score = distBest + distWorst === 0 ? 0 : distWorst / (distBest + distWorst);
    return { ...alt, _distBest: distBest, _distWorst: distWorst, score };
  });

  // 7. Xếp hạng theo score giảm dần
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}

// Export cho môi trường module (test bằng Node); trình duyệt dùng biến toàn cục.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ahpFromPercents, ahpFromMatrix, topsis, AHP_RI };
}
