import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import { expandClasses } from './classTranspiler';

const ARRAY_WRAP = 'ArrayExpression';
const OBJECT_WRAP = 'ObjectExpression';
const FUNCTION_NODES = new Set(['FunctionExpression', 'ArrowFunction']);
const INJECTED_NAMES = new Set([
  '$global',
  '$obj',
  '$arr',
  '$fun',
  'Object',
  'Array',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]);

const WORLD_LITERAL_NAMES = new Set(['undefined', 'NaN', 'Infinity', 'TypeError', 'Error']);

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
  world?: boolean;
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

function rejectVarDeclarations(node: SyntaxNode, source: string): void {
  if (node.name === 'VariableDeclaration') {
    const keyword = declarationKeyword(node, source);
    if (keyword === 'var') {
      throw new Error("'var' is not allowed");
    }
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    rejectVarDeclarations(child, source);
  }
}

function collectTypeParamBindings(typeParamList: SyntaxNode, source: string, bindings: Set<string>): void {
  for (let child = typeParamList.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TypeDefinition' || child.name === 'VariableDefinition') {
      bindings.add(nodeText(child, source));
    }
  }
}

function isRootScope(scope: LexicalScope): boolean {
  return scope.parent === null;
}

function shouldRewriteToWorld(name: string): boolean {
  return !INJECTED_NAMES.has(name) && !WORLD_LITERAL_NAMES.has(name);
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
  readonly rootConstNames = new Set<string>();
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
      const name = nodeText(pending, builder.source);
      builder.addBinding(currentScope, name, kind);
      if (isRootScope(currentScope) && keyword === 'const') builder.rootConstNames.add(name);
    } else {
      const names = new Set<string>();
      collectPatternBindings(pending, builder.source, names);
      for (const name of names) {
        builder.addBinding(currentScope, name, kind);
        if (isRootScope(currentScope) && keyword === 'const') builder.rootConstNames.add(name);
      }
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

function populateFunctionBindings(builder: ScopeBuilder, funcScope: LexicalScope, funcNode: SyntaxNode): void {
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
}

function buildFunctionScope(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  enclosingScope: LexicalScope,
): LexicalScope {
  const funcScope = builder.createScope(enclosingScope, null);
  populateFunctionBindings(builder, funcScope, funcNode);
  return funcScope;
}

function ephemeralScope(parent: LexicalScope | null, blockNode: SyntaxNode | null = null): LexicalScope {
  return new LexicalScope(parent, blockNode, 0);
}

function findBuiltBlockScope(
  builder: ScopeBuilder,
  block: SyntaxNode,
  parent: LexicalScope,
): LexicalScope | null {
  for (const scope of builder.scopes) {
    if (scope.blockNode === block && scope.parent === parent) return scope;
  }
  return null;
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

function functionDeclaresName(funcNode: SyntaxNode, name: string, source: string): boolean {
  const nameNode = funcNode.getChild('VariableDefinition');
  if (nameNode && nodeText(nameNode, source) === name) return true;

  const paramList = funcNode.getChild('ParamList');
  if (!paramList) return false;

  const bindings = new Set<string>();
  let currentParam: SyntaxNode[] = [];
  const processParam = () => {
    for (const part of currentParam) collectParamBindings(part, source, bindings);
    currentParam = [];
  };

  for (let child = paramList.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')') continue;
    if (child.name === ',') processParam();
    else currentParam.push(child);
  }
  processParam();
  return bindings.has(name);
}

function isClosedOverByEnclosingFunction(
  name: string,
  varNode: SyntaxNode,
  funcNode: SyntaxNode,
  source: string,
): boolean {
  let node: SyntaxNode | null = varNode.parent;
  while (node) {
    if (
      node !== funcNode &&
      (node.name === 'ArrowFunction' || node.name === 'FunctionExpression' || node.name === 'FunctionDeclaration') &&
      node.from <= funcNode.from &&
      node.to >= funcNode.to &&
      functionDeclaresName(node, name, source)
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
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
    if (binding?.kind === 'param' || binding?.kind === 'function') return;
    if (isClosedOverByEnclosingFunction(name, node, funcNode, builder.source)) return;

    if (binding?.kind === 'block' && !isRootScope(binding.scope)) {
      binding.scope.freeVarBindings.add(name);
      freeVarUses.push({ name, scope: binding.scope, from: node.from, to: node.to, funcNode });
    } else if (!binding || isRootScope(binding.scope)) {
      freeVarUses.push({
        name,
        scope: binding?.scope ?? currentScope,
        from: node.from,
        to: node.to,
        funcNode,
        world: shouldRewriteToWorld(name),
      });
    } else {
      freeVarUses.push({ name, scope: binding.scope, from: node.from, to: node.to, funcNode });
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

function renderDeclaratorText(source: string, bindingNode: SyntaxNode): string {
  let result = source.slice(bindingNode.from, bindingNode.to);
  let node: SyntaxNode | null = bindingNode.nextSibling;
  while (node && node.name !== ',' && node.name !== ';') {
    result += source.slice(node.from, node.to);
    node = node.nextSibling;
  }
  return result;
}

function declaratorNeedsScope(bindingNode: SyntaxNode, source: string, scopedBindings: Set<string>): boolean {
  if (bindingNode.name === 'VariableDefinition') {
    return scopedBindings.has(nodeText(bindingNode, source));
  }
  const names = new Set<string>();
  collectPatternBindings(bindingNode, source, names);
  for (const name of names) {
    if (scopedBindings.has(name)) return true;
  }
  return false;
}

function declarationIndent(source: string, declNode: SyntaxNode): string {
  let lineStart = declNode.from;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  return source.slice(lineStart, declNode.from);
}

function joinTransformedStatements(
  statements: string[],
  hasTrailingSemicolon: boolean,
  indent: string,
): string {
  if (statements.length === 0) return '';
  return statements
    .map((statement, index) => {
      const bare = statement.replace(/;$/, '');
      const isLast = index === statements.length - 1;
      const text = !isLast || hasTrailingSemicolon ? `${bare};` : bare;
      return index === 0 ? text : `${indent}${text}`;
    })
    .join('\n');
}

function transformBindingDeclaration(
  source: string,
  declNode: SyntaxNode,
  scopeName: string,
  scopedBindings: Set<string>,
): string | null {
  const keyword = declarationKeyword(declNode, source);
  if (!keyword || keyword === 'var') return null;

  let pending: SyntaxNode | null = null;
  const statements: string[] = [];
  let localDeclarators: string[] = [];
  let transformedAny = false;
  const hasTrailingSemicolon = source[declNode.to - 1] === ';';

  const flushLocal = () => {
    if (localDeclarators.length === 0) return;
    statements.push(`${keyword} ${localDeclarators.join(', ')}`);
    localDeclarators = [];
  };

  const flushDeclarator = () => {
    if (!pending) return;
    if (declaratorNeedsScope(pending, source, scopedBindings)) {
      flushLocal();
      if (pending.name === 'VariableDefinition') {
        const name = nodeText(pending, source);
        if (scopedBindings.has(name)) {
          statements.push(renderScopeAssignment(source, pending, scopeName, name));
          transformedAny = true;
        } else {
          localDeclarators.push(renderDeclaratorText(source, pending));
        }
      } else {
        const names = new Set<string>();
        collectPatternBindings(pending, source, names);
        for (const name of names) {
          if (!scopedBindings.has(name)) continue;
          statements.push(renderScopeAssignment(source, pending, scopeName, name));
          transformedAny = true;
        }
      }
    } else {
      localDeclarators.push(renderDeclaratorText(source, pending));
    }
    pending = null;
  };

  for (let child = declNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === ',' || child.name === ';') {
      flushDeclarator();
    }
  }
  flushDeclarator();
  flushLocal();

  return transformedAny ? joinTransformedStatements(statements, hasTrailingSemicolon, declarationIndent(source, declNode)) : null;
}

let nextWorldTmpId = 0;

function freshWorldTmp(): string {
  return `$tmp${++nextWorldTmpId}`;
}

function collectWorldPatternNames(pattern: SyntaxNode, source: string, names: string[]): void {
  if (pattern.name === 'VariableDefinition') {
    names.push(nodeText(pattern, source));
    return;
  }
  for (let child = pattern.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      collectWorldPatternNames(child, source, names);
    } else if (child.name === 'PatternProperty') {
      const varDef = child.getChild('VariableDefinition');
      if (varDef) names.push(nodeText(varDef, source));
      else {
        const propName = child.getChild('PropertyName');
        if (propName) names.push(nodeText(propName, source));
      }
    }
  }
}

function renderObjectDestructuringWorld(
  pattern: SyntaxNode,
  source: string,
  rhs: string,
  statements: string[],
): void {
  const bindings: { worldName: string; key: string }[] = [];
  for (let child = pattern.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'PatternProperty') continue;
    const propName = child.getChild('PropertyName');
    const varDef = child.getChild('VariableDefinition');
    if (!propName) continue;
    const key = nodeText(propName, source);
    const worldName = varDef ? nodeText(varDef, source) : key;
    bindings.push({ worldName, key });
  }
  if (bindings.length === 0) return;

  const tmpNames = bindings.map(() => freshWorldTmp());
  const patternText = bindings
    .map((binding, index) => {
      const tmp = tmpNames[index];
      return binding.key === binding.worldName ? tmp : `${binding.key}: ${tmp}`;
    })
    .join(', ');
  statements.push(`const { ${patternText} } = ${rhs}`);
  for (let i = 0; i < bindings.length; i++) {
    statements.push(`$global.${bindings[i].worldName} = ${tmpNames[i]}`);
  }
}

function renderArrayDestructuringWorld(
  pattern: SyntaxNode,
  source: string,
  rhs: string,
  statements: string[],
): void {
  const names: string[] = [];
  collectWorldPatternNames(pattern, source, names);
  if (names.length === 0) return;

  const tmpNames = names.map(() => freshWorldTmp());
  statements.push(`const [${tmpNames.join(', ')}] = ${rhs}`);
  for (let i = 0; i < names.length; i++) {
    statements.push(`$global.${names[i]} = ${tmpNames[i]}`);
  }
}

function renderWorldDeclarator(
  bindingNode: SyntaxNode,
  source: string,
  statements: string[],
): void {
  if (bindingNode.name === 'VariableDefinition') {
    const name = nodeText(bindingNode, source);
    let init = bindingNode.nextSibling;
    while (init && init.name !== 'Equals') init = init.nextSibling;
    if (!init || init.name !== 'Equals') {
      statements.push(`$global.${name} = undefined`);
      return;
    }
    let expr = init.nextSibling;
    if (!expr || expr.name === ',' || expr.name === ';') {
      statements.push(`$global.${name} = undefined`);
      return;
    }
    statements.push(`$global.${name} = ${source.slice(expr.from, expr.to)}`);
    return;
  }

  let init = bindingNode.nextSibling;
  while (init && init.name !== 'Equals') init = init.nextSibling;
  const rhs =
    init?.name === 'Equals' && init.nextSibling && init.nextSibling.name !== ',' && init.nextSibling.name !== ';'
      ? source.slice(init.nextSibling.from, init.nextSibling.to)
      : 'undefined';

  if (bindingNode.name === 'ObjectPattern') {
    renderObjectDestructuringWorld(bindingNode, source, rhs, statements);
  } else if (bindingNode.name === 'ArrayPattern') {
    renderArrayDestructuringWorld(bindingNode, source, rhs, statements);
  }
}

function transformTopLevelDeclaration(source: string, declNode: SyntaxNode): string | null {
  const keyword = declarationKeyword(declNode, source);
  if (!keyword || keyword === 'var') return null;

  let pending: SyntaxNode | null = null;
  const statements: string[] = [];
  const hasTrailingSemicolon = source[declNode.to - 1] === ';';
  const indent = declarationIndent(source, declNode);

  const flushDeclarator = () => {
    if (!pending) return;
    renderWorldDeclarator(pending, source, statements);
    pending = null;
  };

  for (let child = declNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === ',' || child.name === ';') {
      flushDeclarator();
    }
  }
  flushDeclarator();

  return joinTransformedStatements(statements, hasTrailingSemicolon, indent);
}

function transformTopLevelDeclarations(source: string): string {
  nextWorldTmpId = 0;
  const tree = parser.parse(source);
  const edits: Edit[] = [];

  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDeclaration') {
      const transformed = transformTopLevelDeclaration(source, child);
      if (transformed) {
        edits.push({ kind: 'replace', from: child.from, to: child.to, text: transformed });
      }
    }
  }

  return applyEdits(source, edits);
}

function walkForWorldRefs(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope | null,
  edits: Edit[],
): void {
  if (FUNCTION_NODES.has(node.name)) return;

  if (node.name === 'AssignmentExpression') {
    const lhs = node.firstChild;
    if (lhs?.name === 'VariableName' && isRootScope(currentScope)) {
      const name = nodeText(lhs, builder.source);
      const binding = builder.resolve(name, currentScope);
      if (binding && isRootScope(binding.scope) && builder.rootConstNames.has(name)) {
        throw new Error(`cannot assign to const-declared variable '${name}'`);
      }
      if (!binding || isRootScope(binding.scope)) {
        if (shouldRewriteToWorld(name)) {
          edits.push({ kind: 'replace', from: lhs.from, to: lhs.to, text: `$global.${name}` });
        }
      }
    }
    const rhs = node.lastChild;
    if (rhs && rhs !== lhs) walkForWorldRefs(builder, rhs, currentScope, funcScope, edits);
    return;
  }

  if (node.name === 'UpdateExpression') {
    const varName = node.getChild('VariableName');
    if (varName && isRootScope(currentScope)) {
      const name = nodeText(varName, builder.source);
      const binding = builder.resolve(name, currentScope);
      if (binding && isRootScope(binding.scope) && builder.rootConstNames.has(name)) {
        throw new Error(`cannot assign to const-declared variable '${name}'`);
      }
      if ((!binding || isRootScope(binding.scope)) && shouldRewriteToWorld(name)) {
        edits.push({ kind: 'replace', from: varName.from, to: varName.to, text: `$global.${name}` });
      }
    }
    return;
  }

  if (node.name === 'VariableName') {
    const name = nodeText(node, builder.source);
    if (!shouldRewriteToWorld(name)) return;
    const binding = builder.resolve(name, currentScope);
    if (binding && !isRootScope(binding.scope)) return;
    edits.push({ kind: 'replace', from: node.from, to: node.to, text: `$global.${name}` });
    return;
  }

  if (node.name === 'Block') {
    const innerScope = funcScope
      ? ephemeralScope(funcScope, node)
      : findBuiltBlockScope(builder, node, currentScope) ?? ephemeralScope(currentScope, node);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === '{' || child.name === '}') continue;
      walkForWorldRefsInBlock(builder, child, innerScope, funcScope ?? innerScope, edits);
    }
    return;
  }

  if (node.name === 'VariableDeclaration') {
    registerDeclarationForWorldWalk(builder, node, currentScope, funcScope, edits);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    const nameNode = node.getChild('VariableDefinition');
    if (nameNode) builder.addBinding(currentScope, nodeText(nameNode, builder.source), 'function');
    const block = node.getChild('Block');
    if (block) {
      const innerFuncScope = ephemeralScope(currentScope);
      if (nameNode) builder.addBinding(innerFuncScope, nodeText(nameNode, builder.source), 'function');
      populateFunctionBindings(builder, innerFuncScope, node);
      const bodyScope = ephemeralScope(innerFuncScope, block);
      walkBlockForWorldRefs(builder, block, bodyScope, innerFuncScope, edits);
    }
    return;
  }

  if (node.name === 'ForStatement') {
    const loopScope = ephemeralScope(currentScope, node.getChild('Block'));
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) registerForSpec(spec, builder, loopScope);
    const block = node.getChild('Block');
    if (block) walkBlockForWorldRefs(builder, block, loopScope, funcScope ?? loopScope, edits);
    return;
  }

  if (node.name === 'CatchClause') {
    const catchScope = ephemeralScope(currentScope, node.getChild('Block'));
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') {
        builder.addBinding(catchScope, nodeText(child, builder.source), 'block');
      } else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        addPatternBindings(child, builder, catchScope, 'block');
      } else if (child.name === 'Block') {
        walkBlockForWorldRefs(builder, child, catchScope, funcScope ?? catchScope, edits);
      }
    }
    return;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkForWorldRefs(builder, child, currentScope, funcScope, edits);
  }
}

function registerDeclarationForWorldWalk(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope | null,
  edits: Edit[],
): void {
  const keyword = declarationKeyword(node, builder.source);
  const kind: BindingKind = keyword === 'var' ? 'var' : 'block';
  const bindingScope = keyword === 'var' && funcScope ? funcScope : currentScope;

  let pending: SyntaxNode | null = null;
  const commit = () => {
    if (!pending) return;
    if (pending.name === 'VariableDefinition') {
      const name = nodeText(pending, builder.source);
      builder.addBinding(bindingScope, name, kind);
      if (isRootScope(bindingScope) && keyword === 'const') builder.rootConstNames.add(name);
    } else {
      const names = new Set<string>();
      collectPatternBindings(pending, builder.source, names);
      for (const name of names) {
        builder.addBinding(bindingScope, name, kind);
        if (isRootScope(bindingScope) && keyword === 'const') builder.rootConstNames.add(name);
      }
    }
    pending = null;
  };

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pending = child;
    } else if (child.name === 'Equals') {
      for (let init = child.nextSibling; init; init = init.nextSibling) {
        if (init.name === ';' || init.name === ',') break;
        walkForWorldRefs(builder, init, currentScope, funcScope, edits);
      }
    } else if (child.name === ',' || child.name === ';') {
      commit();
    }
  }
  commit();
}

function walkBlockForWorldRefs(
  builder: ScopeBuilder,
  block: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  edits: Edit[],
): void {
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;
    walkForWorldRefsInBlock(builder, child, currentScope, funcScope, edits);
  }
}

function walkForWorldRefsInBlock(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope | null,
  edits: Edit[],
): void {
  if (FUNCTION_NODES.has(node.name)) return;

  walkForWorldRefs(builder, node, currentScope, funcScope, edits);
}

function collectWorldRefEdits(builder: ScopeBuilder, rootScope: LexicalScope, topNode: SyntaxNode, edits: Edit[]): void {
  for (let child = topNode.firstChild; child; child = child.nextSibling) {
    walkForWorldRefsInBlock(builder, child, rootScope, null, edits);
  }
}

function isObjOrArrCall(node: SyntaxNode, source: string): boolean {
  if (node.name !== 'CallExpression') return false;
  const callee = node.firstChild;
  if (!callee || callee.name !== 'VariableName') return false;
  const name = nodeText(callee, source);
  return name === '$obj' || name === '$arr';
}

function isDirectObjOrArrCallArg(node: SyntaxNode, ancestors: SyntaxNode[], source: string): boolean {
  const argList = ancestors[ancestors.length - 1];
  if (!argList || argList.name !== 'ArgList') return false;
  const call = ancestors[ancestors.length - 2];
  if (!call || !isObjOrArrCall(call, source)) return false;
  const calleeName = nodeText(call.firstChild!, source);
  const expectNode = calleeName === '$obj' ? OBJECT_WRAP : ARRAY_WRAP;
  if (node.name !== expectNode) return false;
  for (let child = argList.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')' || child.name === ',') continue;
    return child.from === node.from && child.to === node.to;
  }
  return false;
}

function collectLiteralEdits(node: SyntaxNode, source: string, edits: Edit[], ancestors: SyntaxNode[]): void {
  if (node.name === ARRAY_WRAP) {
    if (!isDirectObjOrArrCallArg(node, ancestors, source)) {
      edits.push({ kind: 'arr', from: node.from, to: node.to });
    }
  } else if (node.name === OBJECT_WRAP) {
    if (!isDirectObjOrArrCallArg(node, ancestors, source)) {
      edits.push({ kind: 'obj', from: node.from, to: node.to });
    }
  }

  const nextAncestors = [...ancestors, node];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectLiteralEdits(child, source, edits, nextAncestors);
  }
}

function collectScopedBindingNames(
  builder: ScopeBuilder,
  scope: LexicalScope,
  freeVarUses: FreeVarUse[],
): Set<string> {
  const names = new Set<string>();
  for (const use of freeVarUses) {
    if (use.scope !== scope) continue;
    const binding = builder.resolve(use.name, scope);
    if (binding?.scope === scope && binding.kind === 'block') {
      names.add(use.name);
    }
  }
  return names;
}

function collectScopeEdits(builder: ScopeBuilder, freeVarUses: FreeVarUse[], edits: Edit[]): void {
  type DeclTransform = { declNode: SyntaxNode; scopeName: string; bindings: Set<string> };
  const declTransforms = new Map<string, DeclTransform>();

  for (const scope of builder.scopes) {
    if (!scope.needsObject() || !scope.blockNode || isRootScope(scope)) continue;

    const openBrace = scope.blockNode.firstChild;
    if (openBrace?.name === '{') {
      edits.push({ kind: 'insert', pos: openBrace.to, text: `\n  const ${scope.name} = $obj({});` });
    } else if (!scope.parent) {
      edits.push({ kind: 'insert', pos: 0, text: `const ${scope.name} = $obj({});\n` });
    }

    for (const bindingName of collectScopedBindingNames(builder, scope, freeVarUses)) {
      const declNode = findBindingDeclaration(scope.blockNode, builder.source, bindingName);
      if (!declNode) continue;
      const declKey = `${declNode.from}:${declNode.to}`;
      let entry = declTransforms.get(declKey);
      if (!entry) {
        entry = { declNode, scopeName: scope.name, bindings: new Set() };
        declTransforms.set(declKey, entry);
      }
      entry.bindings.add(bindingName);
    }
  }

  for (const { declNode, scopeName, bindings } of declTransforms.values()) {
    const transformed = transformBindingDeclaration(builder.source, declNode, scopeName, bindings);
    if (transformed) {
      edits.push({ kind: 'replace', from: declNode.from, to: declNode.to, text: transformed });
    }
  }

  for (const use of freeVarUses) {
    if (use.world) {
      edits.push({
        kind: 'replace',
        from: use.from,
        to: use.to,
        text: `$global.${use.name}`,
      });
    } else if (use.scope.needsObject()) {
      edits.push({
        kind: 'replace',
        from: use.from,
        to: use.to,
        text: `${use.scope.name}.${use.name}`,
      });
    }
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

function renderFuncCall(
  showInner: string,
  codeInner: string,
  scopes: LexicalScope[],
  declName?: string,
): string {
  const params = renderScopeList(scopes);
  const codeFuncArg = scopes.length > 0 ? `(${params}) => ${codeInner}` : `() => ${codeInner}`;
  const showArg = JSON.stringify(showInner);
  const codeArg = JSON.stringify(codeFuncArg);
  const scopeArg = scopes.length > 0 ? `, [${params}]` : '';
  const call = `$fun(${showArg}, ${codeArg}${scopeArg})`;
  return declName !== undefined ? `const ${declName} = ${call};` : call;
}

function renderEdit(
  source: string,
  start: number,
  end: number,
  edit: Edit,
  originalSource: string,
): string {
  if (edit.kind === 'replace') return edit.text;
  if (edit.kind === 'arr') return `$arr(${source.slice(start, end)})`;
  if (edit.kind === 'obj') return `$obj(${source.slice(start, end)})`;
  if (edit.kind === 'insert') return edit.text;

  const codeInner = source.slice(start, end);
  const showInner = originalSource.slice(edit.from, edit.to);
  if (edit.kind === 'funcDecl') {
    return renderFuncCall(showInner, functionExpressionSource(codeInner), edit.scopes, edit.name);
  }
  return renderFuncCall(showInner, codeInner, edit.scopes);
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
    const text = renderEdit(out, start, end, edit, source);
    out = out.slice(0, start) + text + out.slice(end);
    deltas.push({ pos: edit.to, delta: text.length - (end - start) });
  }

  return out;
}

function parenthesizeNewGlobalTargets(source: string): string {
  return source.replace(/\bnew (?!\()(\$global(?:\.[\w$]+)+)(\s*\()/g, 'new ($1)$2');
}

export function transpileCore(source: string): string {
  const tree = parser.parse(source);
  rejectVarDeclarations(tree.topNode, source);
  const builder = new ScopeBuilder(source);
  const rootScope = builder.createScope(null, tree.topNode);

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
  collectLiteralEdits(tree.topNode, source, edits, []);
  collectScopeEdits(builder, freeVarUses, edits);
  collectWorldRefEdits(builder, rootScope, tree.topNode, edits);
  collectFunctionEdits(functions, freeVarUses, edits);
  const result = applyEdits(source, edits);
  return parenthesizeNewGlobalTargets(transformTopLevelDeclarations(result));
}

export function transpile(source: string): string {
  return transpileCore(expandClasses(source));
}
