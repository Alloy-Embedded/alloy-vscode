// Writing the project's choices into alloy.toml.
//
// Deliberately narrow: this only ever rewrites the `[roles.*]` and `[clock]`
// sections it manages, and leaves every other line — including comments and the
// user's own ordering — exactly where it was. A general TOML round-tripper is a
// much bigger thing to get right, and this file is one a person edits by hand.

export interface ProjectOverrides {
  /** {role: {field: value}} — only fields the CLI declares as project fields. */
  roles: Record<string, Record<string, string | number>>;
  /** A named profile, or a target frequency to solve for. */
  clock?: { profile?: string; mhz?: number } | null;
}

/** Sections this owns. Anything else in the file is none of its business. */
const MANAGED = /^\[(roles(\.[A-Za-z0-9_]+)?|clock)\]/;

/** The header written above the managed block. It belongs to no section, so it
 *  has to be stripped by name — the first version left it behind and it grew by
 *  one copy on every save. */
const HEADER = [
  "# What THIS project chose. The board's own values are defaults; only",
  "# fields the board does not fix can be set here.",
];

function render(value: string | number): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/**
 * `alloy.toml` with the managed sections replaced by `overrides`.
 *
 * Empty sections are dropped rather than written blank: a project that chose
 * nothing should look like one that never chose, or the file accumulates
 * `[roles.debug_uart]` headers with nothing under them.
 */
export function applyOverrides(toml: string, overrides: ProjectOverrides): string {
  // Split into lines and drop every managed section (header + body).
  const kept: string[] = [];
  let skipping = false;
  for (const line of toml.split("\n")) {
    if (/^\s*\[/.test(line)) {
      skipping = MANAGED.test(line.trim());
    }
    if (!skipping && !HEADER.includes(line.trim())) {
      kept.push(line);
    }
  }
  while (kept.length && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }

  const blocks: string[] = [];
  for (const [role, fields] of Object.entries(overrides.roles ?? {})) {
    const entries = Object.entries(fields ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (!entries.length) {
      continue;
    }
    blocks.push(`[roles.${role}]\n`
      + entries.map(([k, v]) => `${k} = ${render(v)}`).join("\n"));
  }
  const clock = overrides.clock;
  if (clock?.profile) {
    blocks.push(`[clock]\nprofile = ${render(clock.profile)}`);
  } else if (clock?.mhz) {
    blocks.push(`[clock]\nmhz = ${render(clock.mhz)}`);
  }

  if (!blocks.length) {
    return `${kept.join("\n")}\n`;
  }
  return `${kept.join("\n")}\n\n${HEADER.join("\n")}\n`
    + `${blocks.join("\n\n")}\n`;
}

/**
 * `overrides`, plus any role in the file the editor never showed.
 *
 * The editor renders the roles the BOARD defines, so a hand-written
 * `[roles.watchdog]` on a board with no watchdog is invisible to it — and
 * rebuilding the block from what the editor knows would delete that line
 * without a word. It is inert (the CLI applies nothing and board-validate
 * reports it as having no effect), but inert is not the same as unwanted, and
 * deleting a line the user typed is not the editor's call.
 */
export function keepUnrendered(toml: string, overrides: ProjectOverrides,
                               rendered: string[]): ProjectOverrides {
  const existing = readOverrides(toml);
  const roles = { ...overrides.roles };
  for (const [role, fields] of Object.entries(existing.roles)) {
    if (!rendered.includes(role)) {
      roles[role] = fields;
    }
  }
  return { ...overrides, roles };
}

/** The overrides currently in a file — so the editor can show them as set. */
export function readOverrides(toml: string): ProjectOverrides {
  const out: ProjectOverrides = { roles: {}, clock: null };
  let section: string | null = null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (!section || !line || line.startsWith("#")) {
      continue;
    }
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) {
      continue;
    }
    const [, key, rawValue] = kv;
    const value: string | number = /^-?\d+(\.\d+)?$/.test(rawValue.trim())
      ? Number(rawValue) : rawValue.trim().replace(/^["']|["']$/g, "");
    if (section.startsWith("roles.")) {
      const role = section.slice("roles.".length);
      (out.roles[role] ??= {})[key] = value;
    } else if (section === "clock" && (key === "profile" || key === "mhz")) {
      out.clock = { ...(out.clock ?? {}), [key]: value } as ProjectOverrides["clock"];
    }
  }
  return out;
}
