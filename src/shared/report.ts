// Two read-only reports: the board matrix and the memory map.
//
// Both are static — nothing to click but a refresh — so they are rendered
// straight to HTML by pure functions instead of getting a webview bundle. That
// keeps them testable in Node and keeps the panel code trivial.

import { MatrixReport, SizeReport, esc } from "./board";

function kb(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return "—";
  }
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function bar(used: number | null, total: number | null, klass: string): string {
  if (used === null || !total) {
    return `<div class="membar"><div class="seg free" style="flex:1">unknown</div></div>`;
  }
  const percent = Math.min(100, (used / total) * 100);
  return `<div class="membar">`
    + `<div class="seg ${klass}" style="flex:${percent.toFixed(3)}">`
    + `${percent >= 12 ? esc(kb(used)) : ""}</div>`
    + `<div class="seg free" style="flex:${(100 - percent).toFixed(3)}">`
    + `${percent < 88 ? `${esc(kb(total - used))} free` : ""}</div></div>`;
}

/**
 * The memory map: what the last build costs, and — on a board with an A/B
 * layout — whether the packed image fits each slot. That last question is the
 * one everybody asks before a field update, and nothing answered it before.
 */
export function renderMemory(report: SizeReport): string {
  if (!report.available) {
    return `<p class="empty">${esc(report.reason ?? "nothing built yet")}</p>`;
  }
  const region = (label: string, use: SizeReport["flash"], klass: string) => `
    <section>
      <div class="rowhead">
        <span class="label">${esc(label)}${
          use.region ? ` <em>${esc(use.region)}</em>` : ""}</span>
        <span class="figure">${esc(kb(use.used))} / ${esc(kb(use.total))}${
          use.percent !== null ? ` · ${use.percent}%` : ""}</span>
      </div>
      ${bar(use.used, use.total, klass)}
    </section>`;

  let html = `<h1>${esc(report.board)}</h1>`
    + `<p class="sub">${esc(report.chip ?? "")}</p>`
    + region("Code", report.flash, "code")
    + region("Data", report.ram, "data");

  if (report.slots) {
    const total = report.slots.regions.reduce((sum, r) => sum + r.size, 0);
    html += `<section><div class="rowhead">
        <span class="label">Firmware slots</span>
        <span class="figure">image ${esc(kb(report.slots.image_bytes))}</span>
      </div><div class="membar">`;
    for (const r of report.slots.regions) {
      const width = (100 * r.size) / total;
      const fit = r.fits === false ? " nofit" : "";
      html += `<div class="seg slot${fit}" style="flex:${width.toFixed(3)}" `
        + `title="${esc(r.name)} @ 0x${r.base.toString(16)} · ${esc(kb(r.size))}">`
        + `${width >= 10 ? esc(r.name) : ""}</div>`;
    }
    html += "</div>";
    const tooBig = report.slots.regions.filter((r) => r.fits === false);
    html += tooBig.length
      ? `<p class="warn">The image does not fit ${
          esc(tooBig.map((r) => r.name).join(", "))} — a field update would be `
        + "refused.</p>"
      : `<p class="hint">The image fits every slot, so <code>alloy update</code> `
        + "can send either one.</p>";
    html += "</section>";
  }
  return html;
}

/**
 * The board matrix: the framework's own claim, checked. One row per board, the
 * same sources, and the cost side by side.
 */
export function renderMatrix(report: MatrixReport): string {
  const rows = report.boards.map((row) => {
    if (!row.ok) {
      return `<tr class="failed"><td>${esc(row.board)}</td>`
        + `<td colspan="3">${esc(row.error ?? "failed")}</td>`
        + `<td class="num">${row.seconds.toFixed(1)}s</td></tr>`;
    }
    const cell = (use: NonNullable<MatrixReport["boards"][number]["flash"]>) =>
      `<td class="num">${esc(kb(use.used))}<span class="of"> / ${
        esc(kb(use.total))}</span>${
        use.percent !== null ? `<span class="pct">${use.percent}%</span>` : ""}</td>`;
    return `<tr><td>${esc(row.board)}</td>`
      + `<td class="chip">${esc(row.chip ?? "")}</td>`
      + cell(row.flash!) + cell(row.ram!)
      + `<td class="num">${row.seconds.toFixed(1)}s</td></tr>`;
  }).join("");

  const headline = report.ok
    ? `${report.built} of ${report.boards.length} boards`
    : `${report.built} built, ${report.failed} failed`;
  return `<h1>${esc(headline)}</h1>
    <p class="sub">The same <code>src/</code>, recompiled for each target. No
    preprocessor conditionals — that is the claim this table checks.</p>
    <table><thead><tr>
      <th>Board</th><th>Chip</th><th class="num">Code</th>
      <th class="num">Data</th><th class="num">Time</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}
