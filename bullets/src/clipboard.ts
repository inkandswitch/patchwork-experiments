import type { BulletsDoc } from "./datatype.ts";
import { escapeHtml } from "./dom-utils.ts";

export type ClipboardNode = {
  content: string;
  title?: string;
  contentType?: string;
  collapsed: boolean;
  starred: boolean;
  children: ClipboardNode[];
};

const MIME_TYPE = "application/x-bullets-nodes";

// --- Serialization (copy out) ---

export function serializeSubtree(
  nodes: BulletsDoc["nodes"],
  nodeId: string,
  visited?: Set<string>
): ClipboardNode {
  if (!visited) visited = new Set<string>();
  visited.add(nodeId);
  const node = nodes[nodeId];
  if (!node) {
    return { content: "", collapsed: false, starred: false, children: [] };
  }
  const children: ClipboardNode[] = [];
  for (const childId of node.children) {
    if (visited.has(childId)) continue;
    children.push(serializeSubtree(nodes, childId, visited));
  }
  const result: ClipboardNode = {
    content: node.content,
    collapsed: node.collapsed ?? false,
    starred: node.starred,
    children,
  };
  if (node.title !== undefined) result.title = node.title;
  if (node.contentType !== undefined) result.contentType = node.contentType;
  return result;
}

export function toPlainText(trees: ClipboardNode[]): string {
  const lines: string[] = [];
  function walk(node: ClipboardNode, depth: number) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- ${node.content}`);
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }
  for (const tree of trees) {
    walk(tree, 0);
  }
  return lines.join("\n");
}

export function toHtml(trees: ClipboardNode[]): string {
  function renderNode(node: ClipboardNode): string {
    let html = `<li>${escapeHtml(node.content)}`;
    if (node.children.length > 0) {
      html += "<ul>";
      for (const child of node.children) {
        html += renderNode(child);
      }
      html += "</ul>";
    }
    html += "</li>";
    return html;
  }
  let html = "<ul>";
  for (const tree of trees) {
    html += renderNode(tree);
  }
  html += "</ul>";
  return html;
}

export function toInternalJson(trees: ClipboardNode[]): string {
  return JSON.stringify(trees);
}

export { MIME_TYPE };

// --- Parsing (paste in) ---

export function parseInternalJson(json: string): ClipboardNode[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    // Basic validation
    for (const node of parsed) {
      if (typeof node.content !== "string" || !Array.isArray(node.children)) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseHtml(html: string): ClipboardNode[] | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Find the first <ul> or <ol> in the parsed document
  const list = doc.querySelector("ul, ol");
  if (!list) return null;

  const trees = parseListElement(list);
  return trees.length > 0 ? trees : null;
}

function parseListElement(list: Element): ClipboardNode[] {
  const nodes: ClipboardNode[] = [];
  for (const child of Array.from(list.children)) {
    if (child.tagName === "LI") {
      nodes.push(parseLiElement(child));
    }
  }
  return nodes;
}

function parseLiElement(li: Element): ClipboardNode {
  // Get direct text content (not from nested lists)
  let content = "";
  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      content += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (el.tagName !== "UL" && el.tagName !== "OL") {
        content += el.textContent || "";
      }
    }
  }
  content = content.trim();

  // Parse nested lists
  const children: ClipboardNode[] = [];
  const nestedList = li.querySelector(":scope > ul, :scope > ol");
  if (nestedList) {
    children.push(...parseListElement(nestedList));
  }

  return { content, collapsed: false, starred: false, children };
}

const BULLET_MARKER_RE = /^(\s*)([-*+]|\d+[.)]) /;

export function parsePlainText(text: string): ClipboardNode[] | null {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Detect indent unit: find the smallest leading whitespace > 0
  let indentUnit = 2;
  for (const line of lines) {
    const match = line.match(/^(\s+)/);
    if (match && match[1].length > 0) {
      indentUnit = Math.min(indentUnit, match[1].length);
      break;
    }
  }

  const roots: ClipboardNode[] = [];
  const stack: { node: ClipboardNode; depth: number }[] = [];

  for (const line of lines) {
    const indentMatch = line.match(/^(\s*)/);
    const rawIndent = indentMatch ? indentMatch[1].length : 0;
    const depth = Math.round(rawIndent / indentUnit);

    // Strip bullet marker
    let content = line.trimStart();
    const markerMatch = content.match(/^([-*+]|\d+[.)]) /);
    if (markerMatch) {
      content = content.slice(markerMatch[0].length);
    }

    const node: ClipboardNode = {
      content,
      collapsed: false,
      starred: false,
      children: [],
    };

    // Pop stack to find parent at depth - 1
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, depth });
  }

  return roots.length > 0 ? roots : null;
}

export function looksLikeStructuredText(text: string): boolean {
  if (text.includes("\n")) return true;
  return BULLET_MARKER_RE.test(text);
}
