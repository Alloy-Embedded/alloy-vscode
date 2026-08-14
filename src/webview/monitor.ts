// The serial monitor panel's client app.
//
// Renders what `alloy monitor --json` streams: stamped lines, a filter, a box
// to send a line back, and a sparkline per `name=value` series the device logs.
// The parsing lives in ../shared/monitor.ts so it can be tested in Node.

import { esc } from "../shared/board";
import {
  MonitorLine, collectSeries, matches, sparkPath, stamp,
} from "../shared/monitor";

const CAP = 5000;  // lines kept; a device left running overnight must not OOM

export function renderLines(lines: MonitorLine[], filter: string): string {
  const shown = lines.filter((entry) => matches(entry.line, filter));
  if (!shown.length) {
    return `<div class="mempty">${
      lines.length ? "nothing matches this filter" : "waiting for the device…"}</div>`;
  }
  return shown.map((entry) => {
    // A decoded bus datagram reads differently from a log line — it is the
    // device's messages, not its printf — so it is marked, and an id the
    // manifest could not name is marked again (that is the case you are
    // staring at the panel to find).
    const kind = entry.bus ? ` bus${entry.bus.name ? "" : " unnamed"}` : "";
    return `<div class="mline${entry.partial ? " partial" : ""}${kind}">`
      + `<span class="mt">${esc(stamp(entry.t))}</span>`
      + `<span class="mx">${esc(entry.line)}</span></div>`;
  }).join("");
}

export function renderSeries(lines: MonitorLine[]): string {
  const series = collectSeries(lines);
  if (!series.length) {
    return "";
  }
  return series.map((s) => {
    const last = s.points[s.points.length - 1];
    const values = s.points.map((p) => p.value);
    const path = sparkPath(s.points, 220, 30);
    return `<div class="mseries">
        <div class="mshead">
          <span class="msname">${esc(s.name)}</span>
          <span class="msnow">${esc(String(last.value))}</span>
        </div>
        <svg viewBox="0 0 220 30" width="220" height="30" preserveAspectRatio="none">
          ${path ? `<path d="${esc(path)}" fill="none" stroke="currentColor"
             stroke-width="1.2"/>` : ""}
        </svg>
        <div class="msrange">${esc(String(Math.min(...values)))} … ${
          esc(String(Math.max(...values)))} · ${s.points.length} pts</div>
      </div>`;
  }).join("");
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
};

export function main(): void {
  const vscode = acquireVsCodeApi();
  const $ = (id: string) => document.getElementById(id);
  let lines: MonitorLine[] = [];
  let filter = "";
  let follow = true;

  const paint = () => {
    const log = $("log");
    if (log) {
      log.innerHTML = renderLines(lines, filter);
      if (follow) {
        log.scrollTop = log.scrollHeight;
      }
    }
    const charts = $("charts");
    if (charts) {
      charts.innerHTML = renderSeries(lines);
    }
  };

  const search = $("filter") as HTMLInputElement | null;
  if (search) {
    search.oninput = () => { filter = search.value; paint(); };
  }
  const log = $("log");
  if (log) {
    // Scrolling up means "let me read"; scrolling back to the bottom resumes.
    log.addEventListener("scroll", () => {
      follow = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    });
  }
  const send = $("send") as HTMLInputElement | null;
  if (send) {
    send.onkeydown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && send.value) {
        vscode.postMessage({ type: "send", text: `${send.value}\n` });
        send.value = "";
      }
    };
  }
  $("clear")?.addEventListener("click", () => { lines = []; paint(); });

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as {
      type: string; lines?: MonitorLine[]; text?: string;
    };
    if (msg.type === "lines" && msg.lines) {
      lines = [...lines, ...msg.lines].slice(-CAP);
      paint();
    } else if (msg.type === "status") {
      const status = $("status");
      if (status) {
        status.textContent = msg.text ?? "";
      }
    }
  });

  paint();
}
