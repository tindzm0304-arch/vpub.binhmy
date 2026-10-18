/* Biểu đồ tròn dùng chung (Chart.js): số ở giữa, chú thích bên dưới; hiện vòng xám khi chưa có dữ liệu.
   Quy ước id: canvas `#id`, số ở giữa `#id-center`, chú thích `#id-legend`. */
import { $, esc } from './utils.js';

const REST_COLOR = '#cbd5e1';
const charts = {};

/**
 * @param {string} id   tiền tố id của biểu đồ
 * @param {{label: string, value: number, color: string}[]} parts  các phần của vòng tròn
 * @param {string|number} centerValue  số hiển thị ở giữa
 * @param {string} unit  nhãn nhỏ dưới số ở giữa
 */
export function drawDonut(id, parts, centerValue, unit) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  $(`#${id}-center`).innerHTML = `<strong>${esc(centerValue)}</strong><span>${esc(unit)}</span>`;
  $(`#${id}-legend`).innerHTML = parts
    .map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${p.value}</b></span>`)
    .join('');

  if (!window.Chart) return;
  const labels = total ? parts.map((p) => p.label) : ['Chưa có dữ liệu'];
  const data = total ? parts.map((p) => p.value) : [1];
  const colors = total ? parts.map((p) => p.color) : [REST_COLOR];

  const chart = charts[id];
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].backgroundColor = colors;
    chart.options.plugins.tooltip.enabled = total > 0;
    chart.update();
    return;
  }
  charts[id] = new Chart($(`#${id}`), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: total > 0 } },
    },
  });
}
