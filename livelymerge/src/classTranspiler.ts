import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import { transpileCore } from './transpiler';

type ClassMember =
  | { kind: 'field'; name: string; init: string }
  | { kind: 'staticField'; name: string; init: string }
  | {
      kind: 'method';
      name: string;
      funcSource: string;
      /** The member's exact class-fragment text (e.g. `get foo() {...}`), super intact.
       * Stored as the Fun's $codeForShow so the browser displays what the user wrote. */
      fragmentSource: string;
      static: boolean;
      accessor: 'method' | 'get' | 'set';
    }
  | { kind: 'staticBlock'; body: string };

type ClassTarget = {
  node: SyntaxNode;
  kind: 'decl' | 'expr';
  topLevel: boolean;
};

function nodeText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

function applyReplacements(
  source: string,
  replacements: { from: number; to: number; text: string }[],
): string {
  replacements.sort((a, b) => b.from - a.from || b.to - a.to);
  let out = source;
  for (const { from, to, text } of replacements) {
    out = out.slice(0, from) + text + out.slice(to);
  }
  return out;
}

function getClassName(node: SyntaxNode, source: string): string | null {
  const nameNode = node.getChild('VariableDefinition');
  return nameNode ? nodeText(nameNode, source) : null;
}

function getExplicitSuperGlobalRef(classNode: SyntaxNode, source: string): string | null {
  for (let child = classNode.firstChild; child; child = child.nextSibling) {
    if (nodeText(child, source) !== 'extends') continue;
    let expr = child.nextSibling;
    if (!expr) return null;
    if (expr.name === 'TypeArguments') expr = expr.nextSibling;
    if (!expr) return null;
    const exprText = nodeText(expr, source);
    return transpileCore(exprText).trim().replace(/;$/, '');
  }
  return null;
}

const IMPLICIT_SUPER = 'Object';

function resolveSuperGlobal(classNode: SyntaxNode, source: string): string {
  return getExplicitSuperGlobalRef(classNode, source) ?? IMPLICIT_SUPER;
}

function prototypeSuffix(superGlobal: string, explicitSuper: string | null): string {
  if (explicitSuper == null && superGlobal === IMPLICIT_SUPER) {
    return '';
  }
  return `, ${superGlobal}.prototype`;
}

function isSuperCallee(callee: SyntaxNode, source: string): boolean {
  return callee.name === 'super' || nodeText(callee, source) === 'super';
}

/** Method names that cannot double as a `function <name>` identifier (`new`, `delete`, …). */
const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
]);

function functionNameFor(methodName: string): string {
  if (RESERVED_WORDS.has(methodName) || !/^[A-Za-z_$][\w$]*$/.test(methodName)) return '';
  return methodName;
}

function methodFuncSource(methodNode: SyntaxNode, source: string, name: string): string {
  let child = methodNode.firstChild;
  while (child && (nodeText(child, source) === 'static' || nodeText(child, source) === 'async')) {
    child = child.nextSibling;
  }
  if (child && (nodeText(child, source) === 'get' || nodeText(child, source) === 'set')) {
    child = child.nextSibling;
  }
  while (child && child.name !== 'ParamList') child = child.nextSibling;
  const paramList = child;
  const block = methodNode.getChild('Block');
  const params = paramList ? nodeText(paramList, source) : '()';
  const body = block ? nodeText(block, source) : '{}';
  const fnName = functionNameFor(name);
  return `function ${fnName}${fnName ? '' : ' '}${params} ${body}`;
}

function blockInner(block: SyntaxNode, source: string): string {
  const open = block.firstChild;
  const close = block.lastChild;
  if (open?.name === '{' && close?.name === '}') {
    return source.slice(open.to, close.from);
  }
  return nodeText(block, source);
}

function methodDeclFlags(
  methodNode: SyntaxNode,
  source: string,
): { name: string | null; isStatic: boolean; accessor: 'method' | 'get' | 'set' } {
  let cursor = methodNode.firstChild;
  let isStatic = false;
  let accessor: 'method' | 'get' | 'set' = 'method';
  while (cursor) {
    if (cursor.name === 'PropertyDefinition') break;
    const text = nodeText(cursor, source);
    if (text === 'static') isStatic = true;
    else if (text === 'get') accessor = 'get';
    else if (text === 'set') accessor = 'set';
    cursor = cursor.nextSibling;
  }
  const nameNode = methodNode.getChild('PropertyDefinition');
  return { name: nameNode ? nodeText(nameNode, source) : null, isStatic, accessor };
}

function parseClassBody(classBody: SyntaxNode, source: string): ClassMember[] {
  const members: ClassMember[] = [];
  for (let child = classBody.firstChild; child; child = child.nextSibling) {
    if (child.name === 'PropertyDeclaration') {
      const nameNode = child.getChild('PropertyDefinition');
      if (!nameNode) continue;
      let isStatic = false;
      for (let cursor = child.firstChild; cursor; cursor = cursor.nextSibling) {
        if (nodeText(cursor, source) === 'static') isStatic = true;
      }
      let init = nameNode.nextSibling;
      while (init && init.name !== 'Equals') init = init.nextSibling;
      if (!init || init.name !== 'Equals') continue;
      let expr = init.nextSibling;
      while (expr && (expr.name === ';' || expr.name === ',')) expr = expr.nextSibling;
      if (!expr) continue;
      const name = nodeText(nameNode, source);
      const initText = nodeText(expr, source);
      if (isStatic) {
        members.push({ kind: 'staticField', name, init: initText });
      } else {
        members.push({ kind: 'field', name, init: initText });
      }
      continue;
    }

    if (child.name === 'StaticBlock') {
      const block = child.getChild('Block');
      if (block) members.push({ kind: 'staticBlock', body: blockInner(block, source) });
      continue;
    }

    if (child.name !== 'MethodDeclaration') continue;

    const { name, isStatic, accessor } = methodDeclFlags(child, source);
    if (name == null) continue;

    if (isStatic && accessor === 'method' && name !== 'constructor') {
      members.push({
        kind: 'method',
        name,
        funcSource: methodFuncSource(child, source, name),
        fragmentSource: nodeText(child, source),
        static: true,
        accessor: 'method',
      });
      continue;
    }

    members.push({
      kind: 'method',
      name,
      funcSource: methodFuncSource(child, source, name),
      fragmentSource: nodeText(child, source),
      static: isStatic,
      accessor,
    });
  }
  return members;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function atMemberName(name: string): string {
  return '@' + name;
}

function memberRef(ref: string, name: string): string {
  return `${ref}['${atMemberName(name)}']`;
}

function rewriteThisMemberAccess(source: string): string {
  // AST-based: a textual regex would also rewrite `this.foo` occurrences inside
  // string literals and comments, corrupting the stored code.
  const tree = parser.parse(source);
  const edits: { from: number; to: number; text: string }[] = [];
  function walk(node: SyntaxNode): void {
    if (node.name === 'MemberExpression') {
      const obj = node.firstChild;
      const prop = node.getChild('PropertyName');
      if (obj?.name === 'this' && prop && prop.from > obj.to) {
        const name = nodeText(prop, source);
        if (!name.startsWith('$') && !name.startsWith('@')) {
          edits.push({ from: obj.to, to: prop.to, text: `['@${name}']` });
        }
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  }
  walk(tree.topNode);
  return applyReplacements(source, edits);
}

function constructorCallsSuper(funcSource: string): boolean {
  const tree = parser.parse(funcSource);
  let found = false;
  function walk(node: SyntaxNode): void {
    if (found) return;
    if (node.name === 'CallExpression') {
      const callee = node.firstChild;
      if (callee && isSuperCallee(callee, funcSource)) {
        found = true;
        return;
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  }
  walk(tree.topNode);
  return found;
}

function rewriteSuperCalls(
  source: string,
  superGlobal: string,
  context: 'constructor' | 'instance' | 'static',
): string {
  const tree = parser.parse(source);
  const edits: { from: number; to: number; text: string }[] = [];

  function rewriteCall(callNode: SyntaxNode): void {
    const callee = callNode.firstChild;
    if (!callee) return;

    if (isSuperCallee(callee, source)) {
      if (context !== 'constructor') return;
      const args = callNode.getChild('ArgList');
      const argsInner = args ? nodeText(args, source).slice(1, -1).trim() : '';
      const text =
        argsInner.length > 0 ? `${superGlobal}.call(this, ${argsInner})` : `${superGlobal}.call(this)`;
      edits.push({ from: callNode.from, to: callNode.to, text });
      return;
    }

    if (callee.name !== 'MemberExpression') return;
    const root = callee.firstChild;
    if (!root || nodeText(root, source) !== 'super') return;
    const propNode = callee.getChild('PropertyName');
    if (!propNode) return;
    const prop = nodeText(propNode, source);
    const args = callNode.getChild('ArgList');
    const argsText = args ? nodeText(args, source) : '()';
    const argsInner = argsText.slice(1, -1).trim();
    const text =
      context === 'static'
        ? `${superGlobal}.${prop}${argsText}`
        : argsInner.length > 0
          ? `${superGlobal}.${prop}.call(this, ${argsInner})`
          : `${superGlobal}.${prop}.call(this)`;
    edits.push({ from: callNode.from, to: callNode.to, text });
  }

  function walk(node: SyntaxNode): void {
    if (node.name === 'CallExpression') rewriteCall(node);
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  }

  walk(tree.topNode);
  return applyReplacements(source, edits);
}

function injectInstanceFields(
  constructorSource: string,
  fields: { name: string; init: string }[],
  afterSuper: boolean,
  superGlobal: string | null,
): string {
  if (fields.length === 0) return constructorSource;

  const tree = parser.parse(constructorSource);
  const func = tree.topNode.firstChild;
  const block = func?.getChild('Block');
  if (!block) return constructorSource;

  const open = block.firstChild;
  const close = block.lastChild;
  if (open?.name !== '{' || close?.name !== '}') return constructorSource;

  const inner = constructorSource.slice(open.to, close.from);
  const fieldLines = fields.map((f) => `this['${atMemberName(f.name)}'] = ${f.init};`).join('\n');

  let newInner: string;
  if (afterSuper && superGlobal) {
    const superCall = new RegExp(`${escapeRegExp(superGlobal)}\\.call\\(this(?:[^)]*)?\\)\\s*;?`);
    const match = superCall.exec(inner);
    if (match) {
      const insertAt = match.index + match[0].length;
      newInner = inner.slice(0, insertAt) + '\n' + fieldLines + inner.slice(insertAt);
    } else {
      newInner = fieldLines + '\n' + inner;
    }
  } else {
    const firstStmt = inner.trimStart();
    newInner = fieldLines + (firstStmt.length > 0 ? '\n' + inner : '');
  }

  return constructorSource.slice(0, open.to) + newInner + constructorSource.slice(close.from);
}

function buildConstructorSource(
  className: string,
  members: ClassMember[],
  superGlobal: string,
  explicitSuper: string | null,
): { show: string; code: string } {
  const instanceFields = members.filter((m): m is Extract<ClassMember, { kind: 'field' }> => m.kind === 'field');
  const ctorMember = members.find(
    (m): m is Extract<ClassMember, { kind: 'method' }> => m.kind === 'method' && m.name === 'constructor',
  );
  const isDerived = explicitSuper != null;

  let ctorSource: string;
  if (ctorMember) {
    ctorSource = ctorMember.funcSource.replace(/^function constructor/, `function ${className}`);
  } else if (isDerived) {
    ctorSource = `function ${className}(...args) {\n${superGlobal}.call(this, ...args);\n}`;
  } else {
    ctorSource = `function ${className}() {}`;
  }

  ctorSource = rewriteSuperCalls(ctorSource, superGlobal, 'constructor');

  const hasExplicitSuperInCtor = ctorMember != null && constructorCallsSuper(ctorMember.funcSource);
  ctorSource = injectInstanceFields(
    ctorSource,
    instanceFields,
    isDerived || hasExplicitSuperInCtor,
    superGlobal,
  );
  return { show: ctorSource, code: rewriteThisMemberAccess(ctorSource) };
}

function extractFunShowArg(transpiled: string): string {
  const trimmed = transpiled.trim().replace(/;$/, '');
  const inner = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  const match = inner.match(/\$fun\("((?:\\.|[^"\\])*)"/);
  if (!match) throw new Error('Expected $fun call');
  return JSON.parse(`"${match[1]}"`);
}

function transpileFunctionSource(codeSource: string, showSource?: string): string {
  const wrapped = transpileCore(`(${codeSource})`).trim().replace(/;$/, '');
  let result = wrapped.startsWith('(') && wrapped.endsWith(')') ? wrapped.slice(1, -1) : wrapped;
  if (showSource && showSource !== codeSource) {
    // Function-form shows round-trip through the transpiler for its normalization;
    // class sources and class fragments (`get foo() {...}`) aren't parseable as
    // expressions and are stored verbatim.
    const showArg = /^(async\s+)?function\b/.test(showSource.trimStart())
      ? JSON.stringify(extractFunShowArg(transpileCore(`(${showSource})`)))
      : JSON.stringify(showSource);
    result = result.replace(/\$fun\("((?:\\.|[^"\\])*)"/, `$fun(${showArg}`);
  }
  return result;
}

/** Prototype accessors become `'@name': $accessor(getFun, setFun)` in the prototype
 * literal. A literal `get`/`set` would be useless there: $obj flattens its argument
 * with Object.entries (invoking any getter once), and heap entries can only store
 * $fun-backed functions. The proxy get/set traps interpret the accessor record. */
function renderAccessorEntries(
  accessors: Extract<ClassMember, { kind: 'method' }>[],
  superGlobal: string,
): string[] {
  const byName = new Map<string, { get?: string; set?: string }>();
  for (const a of accessors) {
    const pair = byName.get(a.name) ?? {};
    const codeSource = rewriteThisMemberAccess(rewriteSuperCalls(a.funcSource, superGlobal, 'instance'));
    const rendered = transpileFunctionSource(codeSource, a.fragmentSource);
    if (a.accessor === 'get') pair.get = rendered;
    else pair.set = rendered;
    byName.set(a.name, pair);
  }
  return [...byName.entries()].map(
    ([name, pair]) =>
      `'${atMemberName(name)}': $accessor(${pair.get ?? 'null'}, ${pair.set ?? 'null'})`,
  );
}

function renderStaticInit(member: ClassMember, ref: string, superGlobal: string): string {
  if (member.kind === 'staticField') {
    const init = transpileCore(member.init).trim().replace(/;$/, '');
    return `${ref}.${member.name} = ${init};`;
  }
  if (member.kind === 'staticBlock') {
    let blockSource = `{\n${member.body}\n}`;
    blockSource = rewriteSuperCalls(blockSource, superGlobal, 'static');
    blockSource = blockSource.replace(/\bthis\b/g, ref);
    return transpileCore(blockSource).trim();
  }
  if (member.kind === 'method' && member.static) {
    // Static accessors have no runtime representation on Fun entries; skip them
    // rather than misinstalling the getter as a plain static method.
    if (member.accessor !== 'method') return '';
    let funcSource = rewriteSuperCalls(member.funcSource, superGlobal, 'static');
    return `${ref}.${member.name} = ${transpileFunctionSource(funcSource, member.fragmentSource)};`;
  }
  return '';
}

function renderClassSetup(
  className: string,
  members: ClassMember[],
  superGlobal: string,
  explicitSuper: string | null,
  bindGlobal: boolean,
  classSource: string,
): string {
  const ref = bindGlobal ? `$global.${className}` : className;
  const lines: string[] = [];
  const firstAssign = bindGlobal ? `${ref} =` : `const ${className} =`;

  const ctor = buildConstructorSource(className, members, superGlobal, explicitSuper);
  lines.push(`${firstAssign} ${transpileFunctionSource(ctor.code, classSource)};`);

  const instanceMethods = members.filter(
    (m): m is Extract<ClassMember, { kind: 'method' }> =>
      m.kind === 'method' && m.name !== 'constructor' && !m.static && m.accessor === 'method',
  );
  const prototypeAccessors = members.filter(
    (m): m is Extract<ClassMember, { kind: 'method' }> =>
      m.kind === 'method' && m.name !== 'constructor' && !m.static && m.accessor !== 'method',
  );

  for (const method of instanceMethods) {
    const codeSource = rewriteThisMemberAccess(rewriteSuperCalls(method.funcSource, superGlobal, 'instance'));
    lines.push(`${memberRef(ref, method.name)} = ${transpileFunctionSource(codeSource, method.fragmentSource)};`);
  }

  // Instances answer `className` via prototype delegation (the classic classProto
  // machinery set `obj.className = this.name` per instance; guards like
  // `morph.className === 'HaloMorph'` throughout newdefs depend on it).
  const classNameProp = `'@className': '${className}'`;
  if (prototypeAccessors.length === 0 && instanceMethods.length > 0) {
    lines.push(
      `${ref}.prototype = $obj({ ${classNameProp}, ${instanceMethods.map((m) => `'${atMemberName(m.name)}': ${memberRef(ref, m.name)}`).join(', ')} }${prototypeSuffix(superGlobal, explicitSuper)});`,
    );
  } else if (prototypeAccessors.length > 0 || instanceMethods.length > 0) {
    const literalParts = [
      classNameProp,
      ...instanceMethods.map((m) => `'${atMemberName(m.name)}': ${memberRef(ref, m.name)}`),
      ...renderAccessorEntries(prototypeAccessors, superGlobal),
    ];
    lines.push(`${ref}.prototype = $obj({ ${literalParts.join(', ')} }${prototypeSuffix(superGlobal, explicitSuper)});`);
  } else {
    lines.push(`${ref}.prototype = $obj({ ${classNameProp} }${prototypeSuffix(superGlobal, explicitSuper)});`);
  }

  for (const member of members) {
    if (member.kind === 'field' || (member.kind === 'method' && (member.name === 'constructor' || !member.static))) {
      continue;
    }
    const line = renderStaticInit(member, ref, superGlobal);
    if (line) lines.push(line);
  }

  return lines.join('\n');
}

function renderClass(node: SyntaxNode, source: string, topLevel: boolean): string {
  const className = getClassName(node, source) ?? '_Class';
  const classSource = nodeText(node, source);
  const explicitSuper = getExplicitSuperGlobalRef(node, source);
  const superGlobal = resolveSuperGlobal(node, source);
  const classBody = node.getChild('ClassBody');
  const members = classBody ? parseClassBody(classBody, source) : [];

  if (topLevel && node.name === 'ClassDeclaration') {
    return renderClassSetup(className, members, superGlobal, explicitSuper, true, classSource);
  }

  const setup = renderClassSetup(className, members, superGlobal, explicitSuper, false, classSource);
  return `(() => {\n${setup}\nreturn ${className};\n})()`;
}

function collectClassTargets(node: SyntaxNode, source: string, parent: SyntaxNode | null, out: ClassTarget[]): void {
  if (node.name === 'ClassDeclaration') {
    out.push({ node, kind: 'decl', topLevel: parent?.name === 'Script' });
    return;
  }
  if (node.name === 'ClassExpression') {
    out.push({ node, kind: 'expr', topLevel: false });
    return;
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectClassTargets(child, source, node, out);
  }
}

function hasParseError(node: SyntaxNode): boolean {
  if (node.type.isError) return true;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (hasParseError(child)) return true;
  }
  return false;
}

/** Parse a single class fragment (`foo(x) {...}`, `get foo() {...}`, `set foo(v) {...}`,
 * `static foo() {...}`, `constructor(...) {...}`) into its ClassMember. Throws on
 * anything else: parse errors, fields, static blocks, zero or multiple members. */
function parseSingleFragmentMember(fragmentSource: string): Extract<ClassMember, { kind: 'method' }> {
  const wrapped = `class __C {\n${fragmentSource}\n}`;
  const tree = parser.parse(wrapped);
  if (hasParseError(tree.topNode)) {
    throw new SyntaxError(`class fragment does not parse:\n${fragmentSource}`);
  }
  const classNode = tree.topNode.firstChild;
  const classBody =
    classNode?.name === 'ClassDeclaration' && classNode.nextSibling == null
      ? classNode.getChild('ClassBody')
      : null;
  if (!classBody) {
    throw new SyntaxError(`class fragment does not parse:\n${fragmentSource}`);
  }
  const members = parseClassBody(classBody, wrapped);
  const member = members[0];
  if (members.length !== 1 || member == null || member.kind !== 'method') {
    throw new SyntaxError(
      'class fragment must contain exactly one method, getter, setter, or constructor',
    );
  }
  if (member.static && member.accessor !== 'method') {
    throw new SyntaxError('static accessors are not supported');
  }
  return member;
}

export type CompiledClassFragment = {
  name: string;
  kind: 'constructor' | 'method' | 'get' | 'set';
  isStatic: boolean;
  /** `$fun("<show>", "<code>")` expression source; evaluate with the runtime params in
   * scope to get the Fun. Super-sends are rewritten in the code, intact in the show. */
  funExpr: string;
};

/** Compile a class fragment for replaceMethod. `superGlobal` is the transpiled
 * superclass reference (e.g. `$global.Morph`), as produced for `extends` clauses;
 * pass 'Object' for base classes. `showSource` overrides the stored $codeForShow
 * (used for constructors, whose show is the full class source). */
export function compileClassFragment(
  fragmentSource: string,
  opts: { className: string; superGlobal: string; showSource?: string },
): CompiledClassFragment {
  const member = parseSingleFragmentMember(fragmentSource);
  const show = opts.showSource ?? fragmentSource.trim();
  if (member.name === 'constructor' && !member.static) {
    if (!/^[A-Za-z_$][\w$]*$/.test(opts.className)) {
      throw new SyntaxError(`invalid class name: ${opts.className}`);
    }
    let ctorSource = member.funcSource.replace(/^function constructor/, `function ${opts.className}`);
    ctorSource = rewriteSuperCalls(ctorSource, opts.superGlobal, 'constructor');
    return {
      name: 'constructor',
      kind: 'constructor',
      isStatic: false,
      funExpr: transpileFunctionSource(rewriteThisMemberAccess(ctorSource), show),
    };
  }
  let funcSource = rewriteSuperCalls(member.funcSource, opts.superGlobal, member.static ? 'static' : 'instance');
  if (!member.static) funcSource = rewriteThisMemberAccess(funcSource);
  return {
    name: member.name,
    kind: member.accessor === 'method' ? 'method' : member.accessor,
    isStatic: member.static,
    funExpr: transpileFunctionSource(funcSource, show),
  };
}

/** Splice a member fragment into a class source string, replacing the member with the
 * same name/staticness/accessor kind, or inserting before the class body's closing
 * brace when absent. Keeps a class's $codeForShow current across replaceMethod edits. */
export function spliceMemberIntoClassSource(classSource: string, fragmentSource: string): string {
  const member = parseSingleFragmentMember(fragmentSource);
  const fragment = fragmentSource.trim();
  const tree = parser.parse(classSource);
  const targets: ClassTarget[] = [];
  collectClassTargets(tree.topNode, classSource, null, targets);
  const classBody = targets.length > 0 ? targets[0].node.getChild('ClassBody') : null;
  if (!classBody) return classSource;
  for (let child = classBody.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'MethodDeclaration') continue;
    const { name, isStatic, accessor } = methodDeclFlags(child, classSource);
    if (name === member.name && isStatic === member.static && accessor === member.accessor) {
      return classSource.slice(0, child.from) + fragment + classSource.slice(child.to);
    }
  }
  const close = classBody.lastChild;
  if (!close || close.name !== '}') return classSource;
  const indented = '  ' + fragment.replace(/\n/g, '\n  ') + '\n';
  const beforeClose = classSource.slice(0, close.from);
  const needsNewline = !/\n\s*$/.test(beforeClose);
  return beforeClose + (needsNewline ? '\n' : '') + indented + classSource.slice(close.from);
}

export function expandClasses(source: string): string {
  const tree = parser.parse(source);
  const targets: ClassTarget[] = [];
  collectClassTargets(tree.topNode, source, null, targets);
  if (targets.length === 0) return source;

  const replacements = targets.map((target) => ({
    from: target.node.from,
    to: target.node.to,
    text: renderClass(target.node, source, target.topLevel && target.kind === 'decl'),
  }));

  return applyReplacements(source, replacements);
}
