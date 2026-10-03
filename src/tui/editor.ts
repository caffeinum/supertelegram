import type { Draft } from "./state";

// single-buffer line editor for the prompt; cursor is a string index
export function insert(d: Draft, text: string): Draft {
  return { ...d, text: d.text.slice(0, d.cursor) + text + d.text.slice(d.cursor), cursor: d.cursor + text.length };
}

export function backspace(d: Draft): Draft {
  if (d.cursor === 0) return d;
  const chars = [...d.text.slice(0, d.cursor)];
  chars.pop();
  const head = chars.join("");
  return { ...d, text: head + d.text.slice(d.cursor), cursor: head.length };
}

export function deleteWord(d: Draft): Draft {
  const head = d.text.slice(0, d.cursor).replace(/\S+\s*$|\s+$/, "");
  return { ...d, text: head + d.text.slice(d.cursor), cursor: head.length };
}

export function deleteToStart(d: Draft): Draft {
  const lineStart = d.text.lastIndexOf("\n", d.cursor - 1) + 1;
  return { ...d, text: d.text.slice(0, lineStart) + d.text.slice(d.cursor), cursor: lineStart };
}

export function move(d: Draft, delta: number): Draft {
  const before = [...d.text.slice(0, d.cursor)];
  const after = [...d.text.slice(d.cursor)];
  if (delta < 0) {
    const n = Math.min(-delta, before.length);
    const moved = before.splice(before.length - n, n);
    return { ...d, cursor: before.join("").length, text: before.join("") + moved.join("") + after.join("") };
  }
  const n = Math.min(delta, after.length);
  return { ...d, cursor: d.cursor + after.slice(0, n).join("").length };
}

export function home(d: Draft): Draft {
  return { ...d, cursor: d.text.lastIndexOf("\n", d.cursor - 1) + 1 };
}

export function end(d: Draft): Draft {
  const nl = d.text.indexOf("\n", d.cursor);
  return { ...d, cursor: nl === -1 ? d.text.length : nl };
}
