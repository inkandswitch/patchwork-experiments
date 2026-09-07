/**
 * Mirror a class-member fragment into a defs file (newdefs.js / QBF.js).
 *
 * Uses the same spliceMemberIntoClassSource helper as replaceMethod's constructor
 * path, scoped to one named class inside a multi-class source file.
 *
 * Usage (dry-run by default):
 *   npx vite-node pwm/mirrorFragment.ts -- --class WorldMorph \
 *     --fragment pwm/fragments/WorldMorph_pwmPing.js --into newdefs.js
 *   … add --write to apply.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parser } from '@lezer/javascript';
import { spliceMemberIntoClassSource } from '../src/classTranspiler.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function stripLeadingComments(src: string): string {
  const lines = src.split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].trim().startsWith('//'))) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

function nodeText(node: { from: number; to: number }, source: string): string {
  return source.slice(node.from, node.to);
}

/** Locate `class ClassName … { … }` (declaration) in a multi-class file. */
export function findClassSpan(
  source: string,
  className: string,
): { from: number; to: number; text: string } | null {
  const tree = parser.parse(source);
  const stack: { node: any; parent: any | null }[] = [{ node: tree.topNode, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop()!;
    if (node.name === 'ClassDeclaration') {
      let nameNode = null as any;
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'VariableDefinition') {
          nameNode = c;
          break;
        }
      }
      if (nameNode && nodeText(nameNode, source) === className) {
        return { from: node.from, to: node.to, text: nodeText(node, source) };
      }
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      stack.push({ node: c, parent: node });
    }
  }
  void parent;
  return null;
}

export function mirrorFragmentIntoSource(
  fileSource: string,
  className: string,
  fragmentSource: string,
): string {
  const span = findClassSpan(fileSource, className);
  if (!span) throw new Error(`PWM mirror: class ${className} not found`);
  const nextClass = spliceMemberIntoClassSource(span.text, fragmentSource.trim());
  return fileSource.slice(0, span.from) + nextClass + fileSource.slice(span.to);
}

function main() {
  const className = arg('--class');
  const fragmentPath = arg('--fragment');
  const intoPath = arg('--into');
  const write = hasFlag('--write');
  if (!className || !fragmentPath || !intoPath) {
    console.error(
      'Usage: pwm/mirrorFragment.ts --class WorldMorph --fragment path.js --into newdefs.js [--write]',
    );
    process.exit(2);
  }
  const fragment = stripLeadingComments(readFileSync(resolve(fragmentPath), 'utf8'));
  const before = readFileSync(resolve(intoPath), 'utf8');
  const after = mirrorFragmentIntoSource(before, className, fragment);
  if (before === after) {
    console.log('PWM mirror: no change (already present or splice no-op)');
    process.exit(0);
  }
  if (!after.includes(fragment.split('\n')[0]!)) {
    console.error('PWM mirror: splice did not insert expected fragment head');
    process.exit(1);
  }
  if (write) {
    writeFileSync(resolve(intoPath), after, 'utf8');
    console.log(`PWM mirror: wrote ${intoPath} (+${after.length - before.length} chars)`);
  } else {
    console.log(
      `PWM mirror dry-run: would update ${intoPath} (+${after.length - before.length} chars). Pass --write to apply.`,
    );
  }
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (/pwm[/\\]mirrorFragment\.ts$/.test(process.argv[1]) || process.argv[1].includes('vite-node'));
if (isDirectRun) main();
