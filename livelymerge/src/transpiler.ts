import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';

const ARRAY_WRAP = 'ArrayExpression';
const OBJECT_WRAP = 'ObjectExpression';
const FUNCTION_NODES = new Set(['FunctionExpression', 'ArrowFunction']);

type BindingKind = 'block' | 'param' | 'var' | 'function';

type Binding = {
  name: string;
  kind: BindingKind;
  scope: LexicalScope;
};

type FreeVarUse = {
  name: string;
  scope: LexicalScope;
  from: number;
  to: number;
  funcNode: SyntaxNode;
};

class LexicalScope {
  readonly id: number;
  readonly name: string;
  readonly parent: LexicalScope | null;
  readonly blockNode: SyntaxNode | null;
  readonly bindings = new Map<string, Binding>();
  freeVarBindings = new Set<string>();

  constructor(parent: LexicalScope | null, blockNode: SyntaxNode | null, id: number) {
    this.id = id;
    this.name = `$scope${id}`;
    this.parent = parent;
    this.blockNode = blockNode;
  }

  needsObject(): boolean {
    return this.freeVarBindings.size > 0;
  }
}

type FunctionTarget = {
  node: SyntaxNode;
  kind: 'expr' | 'decl';
  declName?: string;
};

type Edit =
  | { kind: 'arr'; from: number; to: number }
  | { kind: 'obj'; from: number; to: number }
  | { kind: 'func'; from: number; to: number; scopes: LexicalScope[] }
  | { kind: 'funcDecl'; from: number; to: number; name: string; scopes: LexicalScope[] }
  | { kind: 'replace'; from: number; to: number; text: string }
  | { kind: 'insert'; pos: number; text: string };

function nodeText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

function collectPatternBindings(pattern: SyntaxNode, source: string, bindings: Set<string>): void {
  if (pattern.name === 'VariableDefinition') {
    bindings.add(nodeText(pattern, source));
    return;
  }
  if (pattern.name === 'PatternProperty') {
    const varDef = pattern.getChild('VariableDefinition');
    if (varDef) {
      bindings.add(nodeText(varDef, source));
      return;
    }
    const propName = pattern.getChild('PropertyName');
    if (propName) bindings.add(nodeText(propName, source));
    return;
  }
  for (let child = pattern.firstChild; child; child = child.nextSibling) {
    collectPatternBindings(child, source, bindings);
  }
}

function collectParamBindings(node: SyntaxNode, source: string, bindings: Set<string>): void {
  if (node.name === 'VariableDefinition') {
    bindings.add(nodeText(node, source));
    return;
  }
  if (node.name === 'ObjectPattern' || node.name === 'ArrayPattern') {
    collectPatternBindings(node, source, bindings);
  }
}

function declarationKeyword(node: SyntaxNode, source: string): string | null {
  const first = node.firstChild;
  if (!first) return null;
  const text = nodeText(first, source);
  if (text === 'var' || text === 'let' || text === 'const' || text === 'using') return text;
  return null;
}

function collectTypeParamBindings(typeParamList: SyntaxNode, source: string, bindings: Set<string>): void {
  for (let child = typeParamList.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TypeDefinition' || child.name === 'VariableDefinition') {
      bindings.add(nodeText(child, source));
    }
  }
}

function isAncestorScope(ancestor: LexicalScope, scope: LexicalScope): boolean {
  let current: LexicalScope | null = scope;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function findEnclosingScopeForFunction(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  rootScope: LexicalScope,
): LexicalScope {
  let best: LexicalScope | null = null;
  for (const scope of builder.scopes) {
    if (!scope.blockNode) continue;
    if (funcNode.from >= scope.blockNode.from && funcNode.to <= scope.blockNode.to) {
      if (!best || scope.blockNode.from >= best.blockNode!.from) best = scope;
    }
  }
  return best ?? rootScope;
}

class ScopeBuilder {
  readonly source: string;
  readonly scopes: LexicalScope[] = [];
  private nextScopeId = 1;

  constructor(source: string) {
    this.source = source;
  }

  createScope(parent: LexicalScope | null, blockNode: SyntaxNode | null): LexicalScope {
    const scope = new LexicalScope(parent, blockNode, this.nextScopeId++);
    this.scopes.push(scope);
    return scope;
  }

  addBinding(scope: LexicalScope, name: string, kind: BindingKind): void {
    scope.bindings.set(name, { name, kind, scope });
  }

  resolve(name: string, fromScope: LexicalScope): Binding | null {
    let scope: LexicalScope | null = fromScope;
    while (scope) {
      const binding = scope.bindings.get(name);
      if (binding) return binding;
      scope = scope.parent;
    }
    return null;
  }
}

function collectFunctions(node: SyntaxNode, source: string, out: FunctionTarget[]): void {
  if (node.name === 'FunctionExpression' || node.name === 'ArrowFunction') {
    out.push({ node, kind: 'expr' });
  } else if (node.name === 'FunctionDeclaration') {
    const nameNode = node.getChild('VariableDefinition');
    if (nameNode) out.push({ node, kind: 'decl', declName: nodeText(nameNode, source) });
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectFunctions(child, source, out);
  }
}

function buildScopes(node: SyntaxNode, builder: ScopeBuilder, currentScope: LexicalScope): void {
  if (node.name === 'Block') {
    const blockScope = builder.createScope(currentScope, node);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === '{' || child.name === '}') continue;
      buildScopesInBlock(child, builder, blockScope);
    }
    return;
  }

  buildScopesInBlock(node, builder, currentScope);
}

function buildScopesInBlock(node: SyntaxNode, builder: ScopeBuilder, currentScope: LexicalScope): void {
  if (node.name === 'Block') {
    buildScopes(node, builder, currentScope);
    return;
  }

  if (node.name === 'VariableDeclaration') {
    registerDeclaration(node, builder, currentScope);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    const nameNode = node.getChild('VariableDefinition');
    if (nameNode) builder.addBinding(currentScope, nodeText(nameNode, builder.source), 'function');
    const block = node.getChild('Block');
    if (block) buildScopes(block, builder, currentScope);
    return;
  }

  if (node.name === 'ForStatement') {
    const loopScope = builder.createScope(currentScope, node.getChild('Block'));
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) registerForSpec(spec, builder, loopScope);
    const block = node.getChild('Block');
    if (block) {
      for (let child = block.firstChild; child; child = child.nextSibling) {
        if (child.name === '{' || child.name === '}') continue;
        buildScopesInBlock(child, builder, loopScope);
      }
    }
    return;
  }

  if (node.name === 'CatchClause') {
    const catchScope = builder.createScope(currentScope, node.getChild('Block'));
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') {
        builder.addBinding(catchScope, nodeText(child, builder.source), 'block');
      } else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        addPatternBindings(child, builder, catchScope, 'block');
      } else if (child.name === 'Block') {
        for (let blockChild = child.firstChild; blockChild; blockChild = blockChild.nextSibling) {
          if (blockChild.name === '{' || blockChild.name === '}') continue;
          buildScopesInBlock(blockChild, builder, catchScope);
        }
      }
    }
    return;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    buildScopesInBlock(child, builder, currentScope);
  }
}

function registerDeclaration(node: SyntaxNode, builder: ScopeBuilder, currentScope: LexicalScope): void {
  const keyword = declarationKeyword(node, builder.source);
  const kind: BindingKind = keyword === 'var' ? 'var' : 'block';
  let pending: SyntaxNode | null = null;

  const commit = () => {
    if (!pending) return;
    if (pending.name === 'VariableDefinition') {
      builder.addBinding(currentScope, nodeText(pending, builder.source), kind);
    } else {
      addPatternBindings(pending, builder, currentScope, kind);
    }
    pending = null;
  };

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === ',' || child.name === ';') {
      commit();
    }
  }
  commit();
}

function addPatternBindings(
  pattern: SyntaxNode,
  builder: ScopeBuilder,
  scope: LexicalScope,
  kind: BindingKind,
): void {
  const names = new Set<string>();
  collectPatternBindings(pattern, builder.source, names);
  for (const name of names) builder.addBinding(scope, name, kind);
}

function registerForSpec(spec: SyntaxNode, builder: ScopeBuilder, loopScope: LexicalScope): void {
  for (let child = spec.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDeclaration') registerDeclaration(child, builder, loopScope);
    else if (child.name === 'VariableDefinition') builder.addBinding(loopScope, nodeText(child, builder.source), 'block');
    else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      addPatternBindings(child, builder, loopScope, 'block');
    }
  }
}

function buildFunctionScope(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  enclosingScope: LexicalScope,
): LexicalScope {
  const funcScope = builder.createScope(enclosingScope, null);

  if (funcNode.name === 'FunctionExpression') {
    for (let child = funcNode.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') {
        builder.addBinding(funcScope, nodeText(child, builder.source), 'function');
      }
    }
  }

  if (funcNode.name === 'FunctionDeclaration') {
    const nameNode = funcNode.getChild('VariableDefinition');
    if (nameNode) builder.addBinding(funcScope, nodeText(nameNode, builder.source), 'function');
  }

  const typeParams = funcNode.getChild('TypeParamList');
  if (typeParams) {
    const names = new Set<string>();
    collectTypeParamBindings(typeParams, builder.source, names);
    for (const name of names) builder.addBinding(funcScope, name, 'param');
  }

  registerParams(funcNode.getChild('ParamList'), builder, funcScope);
  return funcScope;
}

function registerParams(paramList: SyntaxNode | null, builder: ScopeBuilder, funcScope: LexicalScope): void {
  if (!paramList) return;

  let currentParam: SyntaxNode[] = [];
  const processParam = () => {
    for (const part of currentParam) {
      if (part.name === 'VariableDefinition') {
        builder.addBinding(funcScope, nodeText(part, builder.source), 'param');
      } else if (part.name === 'ObjectPattern' || part.name === 'ArrayPattern') {
        addPatternBindings(part, builder, funcScope, 'param');
      }
    }
    currentParam = [];
  };

  for (let child = paramList.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')') continue;
    if (child.name === ',') processParam();
    else currentParam.push(child);
  }
  processParam();
}

function analyzeFreeVarsForFunction(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  enclosingScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  const funcScope = buildFunctionScope(builder, funcNode, enclosingScope);
  const funcBodyScope = funcScope;

  walkParamDefaults(builder, funcNode.getChild('ParamList'), funcNode, funcScope, funcScope, freeVarUses);

  if (funcNode.name === 'ArrowFunction') {
    const block = funcNode.getChild('Block');
    if (block) {
      const bodyScope = builder.createScope(funcScope, block);
      walkFunctionBody(builder, block, funcNode, bodyScope, funcScope, freeVarUses);
    } else {
      let body: SyntaxNode | null = funcNode.getChild('Arrow')?.nextSibling ?? null;
      while (body && (body.name === 'TypeAnnotation' || body.name === '⚠')) body = body.nextSibling;
      if (body) walkFreeVarNode(builder, body, funcNode, funcBodyScope, funcScope, freeVarUses, []);
    }
    return;
  }

  const block = funcNode.getChild('Block');
  if (block) {
    const bodyScope = builder.createScope(funcScope, block);
    walkFunctionBody(builder, block, funcNode, bodyScope, funcScope, freeVarUses);
  }
}

function walkParamDefaults(
  builder: ScopeBuilder,
  paramList: SyntaxNode | null,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  if (!paramList) return;

  let currentParam: SyntaxNode[] = [];
  const processParam = () => {
    for (const part of currentParam) {
      if (part.name !== 'Equals') continue;
      for (let init = part.nextSibling; init; init = init.nextSibling) {
        if (init.name === ',' || init.name === ')') break;
        walkFreeVarNode(builder, init, funcNode, currentScope, funcScope, freeVarUses, [paramList]);
      }
    }
    currentParam = [];
  };

  for (let child = paramList.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')') continue;
    if (child.name === ',') processParam();
    else currentParam.push(child);
  }
  processParam();
}

function walkFunctionBody(
  builder: ScopeBuilder,
  block: SyntaxNode,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;
    walkFunctionBodyNode(builder, child, funcNode, currentScope, funcScope, freeVarUses);
  }
}

function walkFunctionBodyNode(
  builder: ScopeBuilder,
  node: SyntaxNode,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  if (node !== funcNode && FUNCTION_NODES.has(node.name)) return;

  if (node.name === 'Block') {
    const innerScope = builder.createScope(funcScope, node);
    walkFunctionBody(builder, node, funcNode, innerScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'VariableDeclaration') {
    walkDeclarationForFreeVars(builder, node, funcNode, currentScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    const nameNode = node.getChild('VariableDefinition');
    if (nameNode) builder.addBinding(funcScope, nodeText(nameNode, builder.source), 'function');
    const block = node.getChild('Block');
    if (block) walkFunctionBody(builder, block, funcNode, currentScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'ForStatement') {
    const loopScope = builder.createScope(currentScope, node.getChild('Block'));
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) registerForSpec(spec, builder, loopScope);
    const block = node.getChild('Block');
    if (block) walkFunctionBody(builder, block, funcNode, loopScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'CatchClause') {
    const catchScope = builder.createScope(currentScope, node.getChild('Block'));
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') builder.addBinding(catchScope, nodeText(child, builder.source), 'block');
      else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        addPatternBindings(child, builder, catchScope, 'block');
      } else if (child.name === 'Block') {
        walkFunctionBody(builder, child, funcNode, catchScope, funcScope, freeVarUses);
      }
    }
    return;
  }

  walkFreeVarNode(builder, node, funcNode, currentScope, funcScope, freeVarUses, []);
}

function walkDeclarationForFreeVars(
  builder: ScopeBuilder,
  node: SyntaxNode,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  const keyword = declarationKeyword(node, builder.source);
  const kind: BindingKind = keyword === 'var' ? 'var' : 'block';
  const bindingScope = keyword === 'var' ? funcScope : currentScope;

  let pending: SyntaxNode | null = null;
  const commit = () => {
    if (!pending) return;
    if (pending.name === 'VariableDefinition') {
      builder.addBinding(bindingScope, nodeText(pending, builder.source), kind);
    } else {
      addPatternBindings(pending, builder, bindingScope, kind);
    }
    pending = null;
  };

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === 'Equals') {
      for (let init = child.nextSibling; init; init = init.nextSibling) {
        if (init.name === ';' || init.name === ',') break;
        walkFreeVarNode(builder, init, funcNode, currentScope, funcScope, freeVarUses, [node]);
      }
    } else if (child.name === ',' || child.name === ';') {
      commit();
    }
  }
  commit();
}

function walkFreeVarNode(
  builder: ScopeBuilder,
  node: SyntaxNode,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  freeVarUses: FreeVarUse[],
  ancestors: SyntaxNode[],
): void {
  if (node !== funcNode && FUNCTION_NODES.has(node.name)) return;

  if (node.name === 'VariableName') {
    const name = nodeText(node, builder.source);
    const binding = builder.resolve(name, currentScope);
    if (binding && (binding.scope === funcScope || isAncestorScope(funcScope, binding.scope))) return;

    if (binding?.kind === 'block') {
      binding.scope.freeVarBindings.add(name);
      freeVarUses.push({ name, scope: binding.scope, from: node.from, to: node.to, funcNode });
    } else {
      freeVarUses.push({ name, scope: binding?.scope ?? currentScope, from: node.from, to: node.to, funcNode });
    }
    return;
  }

  if (node.name === 'Block') {
    const innerScope = builder.createScope(funcScope, node);
    walkFunctionBody(builder, node, funcNode, innerScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'VariableDeclaration') {
    walkDeclarationForFreeVars(builder, node, funcNode, currentScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    walkFunctionBodyNode(builder, node, funcNode, currentScope, funcScope, freeVarUses);
    return;
  }

  if (node.name === 'ForStatement' || node.name === 'CatchClause') {
    walkFunctionBodyNode(builder, node, funcNode, currentScope, funcScope, freeVarUses);
    return;
  }

  const nextAncestors = [...ancestors, node];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkFreeVarNode(builder, child, funcNode, currentScope, funcScope, freeVarUses, nextAncestors);
  }
}

function scopesForFunction(freeVarUses: FreeVarUse[], funcNode: SyntaxNode): LexicalScope[] {
  const scopeSet = new Set<LexicalScope>();
  for (const use of freeVarUses) {
    if (use.funcNode.from !== funcNode.from || use.funcNode.to !== funcNode.to) continue;
    if (use.scope.needsObject()) scopeSet.add(use.scope);
  }
  return [...scopeSet].sort((a, b) => a.id - b.id);
}

function functionExpressionSource(declSource: string): string {
  const tree = parser.parse(declSource);
  const decl = tree.topNode.firstChild;
  if (decl?.name !== 'FunctionDeclaration') return declSource;

  const nameNode = decl.getChild('VariableDefinition');
  if (!nameNode) return declSource;
  const before = declSource.slice(0, nameNode.from).replace(/\s+$/, '');
  return before + declSource.slice(nameNode.to);
}

function renderScopeList(scopes: LexicalScope[]): string {
  return scopes.map((scope) => scope.name).join(', ');
}

function bindingNodeContainsName(node: SyntaxNode, source: string, bindingName: string): boolean {
  const names = new Set<string>();
  if (node.name === 'VariableDefinition') names.add(nodeText(node, source));
  else collectPatternBindings(node, source, names);
  return names.has(bindingName);
}

function declarationContainsBinding(node: SyntaxNode, source: string, bindingName: string): boolean {
  let pending: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === ',' || child.name === ';') {
      if (pending && bindingNodeContainsName(pending, source, bindingName)) return true;
      pending = null;
    }
  }
  return pending !== null && bindingNodeContainsName(pending, source, bindingName);
}

function findBindingDeclaration(blockNode: SyntaxNode, source: string, bindingName: string): SyntaxNode | null {
  for (let child = blockNode.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'VariableDeclaration') continue;
    if (declarationContainsBinding(child, source, bindingName)) return child;
  }
  return null;
}

function renderScopeAssignment(source: string, bindingNode: SyntaxNode, scopeName: string, bindingName: string): string {
  let init = bindingNode.nextSibling;
  while (init && init.name !== 'Equals') init = init.nextSibling;
  if (!init || init.name !== 'Equals') return `${scopeName}.${bindingName} = undefined`;
  let expr = init.nextSibling;
  if (!expr || expr.name === ',' || expr.name === ';') return `${scopeName}.${bindingName} = undefined`;
  return `${scopeName}.${bindingName} = ${source.slice(expr.from, expr.to)}`;
}

function renderDeclarator(source: string, keyword: string, bindingNode: SyntaxNode): string {
  let result = `${keyword} ${source.slice(bindingNode.from, bindingNode.to)}`;
  let node: SyntaxNode | null = bindingNode.nextSibling;
  while (node && node.name !== ',' && node.name !== ';') {
    result += source.slice(node.from, node.to);
    node = node.nextSibling;
  }
  return result;
}

function transformBindingDeclaration(source: string, declNode: SyntaxNode, scopeName: string, bindingName: string): string | null {
  const keyword = declarationKeyword(declNode, source);
  if (!keyword || keyword === 'var') return null;

  let pending: SyntaxNode | null = null;
  const parts: string[] = [];
  let transformedAny = false;

  const flush = (terminator: string) => {
    if (!pending) return;
    if (bindingNodeContainsName(pending, source, bindingName)) {
      parts.push(renderScopeAssignment(source, pending, scopeName, bindingName) + terminator.trimEnd());
      transformedAny = true;
    } else {
      parts.push(renderDeclarator(source, keyword, pending) + terminator);
    }
    pending = null;
  };

  for (let child = declNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === ',') {
      flush(',');
    } else if (child.name === ';') {
      flush(';');
    }
  }

  return transformedAny ? parts.join(' ') : null;
}

function collectLiteralEdits(node: SyntaxNode, edits: Edit[]): void {
  if (node.name === ARRAY_WRAP) {
    edits.push({ kind: 'arr', from: node.from, to: node.to });
  } else if (node.name === OBJECT_WRAP) {
    edits.push({ kind: 'obj', from: node.from, to: node.to });
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectLiteralEdits(child, edits);
  }
}

function collectScopeEdits(builder: ScopeBuilder, freeVarUses: FreeVarUse[], edits: Edit[]): void {
  for (const scope of builder.scopes) {
    if (!scope.needsObject() || !scope.blockNode) continue;

    const openBrace = scope.blockNode.firstChild;
    if (openBrace?.name === '{') {
      edits.push({ kind: 'insert', pos: openBrace.to, text: `\n  const ${scope.name} = $obj({});` });
    }

    for (const bindingName of scope.freeVarBindings) {
      const declNode = findBindingDeclaration(scope.blockNode, builder.source, bindingName);
      if (!declNode) continue;
      const transformed = transformBindingDeclaration(builder.source, declNode, scope.name, bindingName);
      if (transformed) {
        edits.push({ kind: 'replace', from: declNode.from, to: declNode.to, text: transformed });
      }
    }
  }

  for (const use of freeVarUses) {
    if (!use.scope.needsObject()) continue;
    edits.push({
      kind: 'replace',
      from: use.from,
      to: use.to,
      text: `${use.scope.name}.${use.name}`,
    });
  }
}

function collectFunctionEdits(functions: FunctionTarget[], freeVarUses: FreeVarUse[], edits: Edit[]): void {
  for (const target of functions) {
    const scopes = scopesForFunction(freeVarUses, target.node);
    if (target.kind === 'decl') {
      edits.push({
        kind: 'funcDecl',
        from: target.node.from,
        to: target.node.to,
        name: target.declName!,
        scopes,
      });
    } else {
      edits.push({ kind: 'func', from: target.node.from, to: target.node.to, scopes });
    }
  }
}

function editSpan(edit: Edit): number {
  if (edit.kind === 'insert') return 0;
  return edit.to - edit.from;
}

function editSortKey(edit: Edit): [number, number] {
  if (edit.kind === 'insert') return [edit.pos, 0];
  return [edit.from, editSpan(edit)];
}

function mapPos(pos: number, deltas: { pos: number; delta: number }[]): number {
  let extra = 0;
  for (const d of deltas) {
    if (d.pos <= pos) extra += d.delta;
  }
  return pos + extra;
}

function renderFuncCall(inner: string, scopes: LexicalScope[], declName?: string): string {
  const params = renderScopeList(scopes);
  const funcArg = `(${params}) => ${inner}`;
  const scopeArg = scopes.length > 0 ? `, [${params}]` : '';
  const call = `$func(${funcArg}${scopeArg})`;
  return declName !== undefined ? `const ${declName} = ${call};` : call;
}

function renderEdit(source: string, start: number, end: number, edit: Edit): string {
  if (edit.kind === 'replace') return edit.text;
  if (edit.kind === 'arr') return `$arr(${source.slice(start, end)})`;
  if (edit.kind === 'obj') return `$obj(${source.slice(start, end)})`;
  if (edit.kind === 'insert') return edit.text;

  const inner = source.slice(start, end);
  if (edit.kind === 'funcDecl') {
    return renderFuncCall(functionExpressionSource(inner), edit.scopes, edit.name);
  }
  return renderFuncCall(inner, edit.scopes);
}

function applyEdits(source: string, edits: Edit[]): string {
  edits.sort((a, b) => {
    const [aPos, aSpan] = editSortKey(a);
    const [bPos, bSpan] = editSortKey(b);
    if (aSpan !== bSpan) return aSpan - bSpan;
    return bPos - aPos;
  });

  const deltas: { pos: number; delta: number }[] = [];
  let out = source;

  for (const edit of edits) {
    if (edit.kind === 'insert') {
      const pos = mapPos(edit.pos, deltas);
      out = out.slice(0, pos) + edit.text + out.slice(pos);
      deltas.push({ pos: edit.pos, delta: edit.text.length });
      continue;
    }

    const start = mapPos(edit.from, deltas);
    const end = mapPos(edit.to, deltas);
    const text = renderEdit(out, start, end, edit);
    out = out.slice(0, start) + text + out.slice(end);
    deltas.push({ pos: edit.to, delta: text.length - (end - start) });
  }

  return out;
}

export function transpile(source: string): string {
  const tree = parser.parse(source);
  const builder = new ScopeBuilder(source);
  const rootScope = builder.createScope(null, null);

  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    buildScopesInBlock(child, builder, rootScope);
  }

  const functions: FunctionTarget[] = [];
  collectFunctions(tree.topNode, source, functions);

  const freeVarUses: FreeVarUse[] = [];
  for (const target of functions) {
    const enclosingScope = findEnclosingScopeForFunction(builder, target.node, rootScope);
    analyzeFreeVarsForFunction(builder, target.node, enclosingScope, freeVarUses);
  }

  const edits: Edit[] = [];
  collectLiteralEdits(tree.topNode, edits);
  collectScopeEdits(builder, freeVarUses, edits);
  collectFunctionEdits(functions, freeVarUses, edits);
  return applyEdits(source, edits);
}
