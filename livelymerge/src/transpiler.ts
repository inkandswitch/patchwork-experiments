import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import { expandClasses } from './classTranspiler';

const ARRAY_WRAP = 'ArrayExpression';
const OBJECT_WRAP = 'ObjectExpression';
const FUNCTION_NODES = new Set(['FunctionExpression', 'ArrowFunction']);
const ALL_FUNCTION_NODES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction']);
const DO_NOT_TRANSPILE_COMMENT = '// $$$ do not transpile $$$';
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
  // Names of this function's own parameters that are captured by a nested closure
  // and therefore promoted onto this scope's $obj. Unlike block bindings they have
  // no `let`/`const` declaration to transform, so they need an explicit seed
  // assignment (`$scopeN.p = p;`) at the top of the body.
  capturedParams = new Set<string>();
  // True when a nested closure references `this` and this scope is the body scope of
  // the regular function that owns that `this`. Serialized closures lose JS's lexical
  // `this`, so the owner seeds `$scopeN.$this = this;` at the top of its body and the
  // closure reads `$scopeN.$this` instead of a bare `this`.
  capturedThis = false;

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
  | { kind: 'funcDecl'; from: number; to: number; name: string; scopes: LexicalScope[]; scopeAssignment?: string }
  | { kind: 'replace'; from: number; to: number; text: string }
  | { kind: 'insert'; pos: number; text: string };

function nodeText(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

function firstBlockStatement(block: SyntaxNode): SyntaxNode | null {
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;
    return child;
  }
  return null;
}

function isDoNotTranspileFunction(funcNode: SyntaxNode, source: string): boolean {
  if (!ALL_FUNCTION_NODES.has(funcNode.name)) return false;
  const block = funcNode.getChild('Block');
  if (!block) return false;
  const first = firstBlockStatement(block);
  if (!first || first.name !== 'LineComment') return false;
  return nodeText(first, source).trim() === DO_NOT_TRANSPILE_COMMENT;
}

function isInsideDoNotTranspileFunction(ancestors: SyntaxNode[], source: string): boolean {
  for (const node of ancestors) {
    if (isDoNotTranspileFunction(node, source)) return true;
  }
  return false;
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

function rejectVarDeclarations(node: SyntaxNode, source: string, ancestors: SyntaxNode[] = []): void {
  if (isInsideDoNotTranspileFunction(ancestors, source)) return;
  if (node.name === 'VariableDeclaration') {
    const keyword = declarationKeyword(node, source);
    if (keyword === 'var') {
      throw new Error("'var' is not allowed");
    }
  }
  const nextAncestors = [...ancestors, node];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    rejectVarDeclarations(child, source, nextAncestors);
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

function functionDeclaredName(funcNode: SyntaxNode, source: string): string | null {
  const nameNode = funcNode.getChild('VariableDefinition');
  return nameNode ? nodeText(nameNode, source) : null;
}

function isReferenceUsedAsMemberObject(source: string, from: number, to: number): boolean {
  let i = to;
  while (i < source.length && /\s/.test(source[i] ?? '')) i++;
  return source[i] === '.';
}

function isOwnFunctionNameMemberAccess(
  node: SyntaxNode,
  funcNode: SyntaxNode,
  source: string,
): boolean {
  if (node.name !== 'VariableName') return false;
  const name = nodeText(node, source);
  if (functionDeclaredName(funcNode, source) !== name) return false;
  return isReferenceUsedAsMemberObject(source, node.from, node.to);
}

function isGlobalFunctionSelfRef(
  name: string,
  binding: Binding,
  funcNode: SyntaxNode,
  funcScope: LexicalScope,
  enclosingScope: LexicalScope,
  source: string,
): boolean {
  return (
    funcNode.name === 'FunctionDeclaration' &&
    isRootScope(enclosingScope) &&
    binding.kind === 'function' &&
    binding.scope === funcScope &&
    functionDeclaredName(funcNode, source) === name
  );
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
  const skipBody = isDoNotTranspileFunction(node, source);

  if (!skipBody) {
    if (node.name === 'FunctionExpression' || node.name === 'ArrowFunction') {
      out.push({ node, kind: 'expr' });
    } else if (node.name === 'FunctionDeclaration') {
      const nameNode = node.getChild('VariableDefinition');
      if (nameNode) out.push({ node, kind: 'decl', declName: nodeText(nameNode, source) });
    }
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (skipBody && child.name === 'Block') continue;
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
  if (isDoNotTranspileFunction(node, builder.source)) {
    if (node.name === 'FunctionDeclaration') {
      const nameNode = node.getChild('VariableDefinition');
      if (nameNode) builder.addBinding(currentScope, nodeText(nameNode, builder.source), 'function');
    }
    return;
  }

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

function forEachForSpecExpression(spec: SyntaxNode, visit: (expr: SyntaxNode) => void): void {
  for (let child = spec.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDeclaration') {
      for (let declChild = child.firstChild; declChild; declChild = declChild.nextSibling) {
        if (declChild.name !== 'Equals') continue;
        for (let init = declChild.nextSibling; init; init = init.nextSibling) {
          if (init.name === ';' || init.name === ',') break;
          visit(init);
        }
      }
    } else if (
      child.name === 'VariableDefinition' ||
      child.name === 'ObjectPattern' ||
      child.name === 'ArrayPattern' ||
      child.name === 'of' ||
      child.name === 'in' ||
      child.name === ';'
    ) {
      continue;
    } else {
      visit(child);
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

function blockScopeForAnalysis(
  builder: ScopeBuilder,
  block: SyntaxNode,
  parentScope: LexicalScope,
): LexicalScope {
  return findBuiltBlockScope(builder, block, parentScope) ?? builder.createScope(parentScope, block);
}

function resolveInFunction(
  builder: ScopeBuilder,
  name: string,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
): Binding | null {
  return builder.resolve(name, currentScope) ?? builder.resolve(name, funcScope);
}

function registerFunctionBodyDeclarations(
  builder: ScopeBuilder,
  block: SyntaxNode,
  currentScope: LexicalScope,
): void {
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;

    if (child.name === 'FunctionDeclaration') {
      const nameNode = child.getChild('VariableDefinition');
      if (nameNode) builder.addBinding(currentScope, nodeText(nameNode, builder.source), 'function');
    } else if (child.name === 'Block') {
      const innerScope = blockScopeForAnalysis(builder, child, currentScope);
      registerFunctionBodyDeclarations(builder, child, innerScope);
    } else if (child.name === 'ForStatement') {
      const loopBlock = child.getChild('Block');
      const loopScope = loopBlock ? blockScopeForAnalysis(builder, loopBlock, currentScope) : currentScope;
      if (loopBlock) registerFunctionBodyDeclarations(builder, loopBlock, loopScope);
    } else if (child.name === 'CatchClause') {
      const catchBlock = child.getChild('Block');
      const catchScope = catchBlock ? blockScopeForAnalysis(builder, catchBlock, currentScope) : currentScope;
      if (catchBlock) registerFunctionBodyDeclarations(builder, catchBlock, catchScope);
    }
  }
}

function analyzeFreeVarsForFunction(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  enclosingScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  const funcScope = buildFunctionScope(builder, funcNode, enclosingScope);
  const funcBodyScope = funcScope;

  walkParamDefaults(builder, funcNode.getChild('ParamList'), funcNode, funcScope, funcScope, enclosingScope, freeVarUses);

  if (funcNode.name === 'ArrowFunction') {
    const block = funcNode.getChild('Block');
    if (block) {
      const bodyScope = blockScopeForAnalysis(builder, block, enclosingScope);
      registerFunctionBodyDeclarations(builder, block, bodyScope);
      walkFunctionBody(builder, block, funcNode, bodyScope, funcScope, enclosingScope, freeVarUses);
    } else {
      let body: SyntaxNode | null = funcNode.getChild('Arrow')?.nextSibling ?? null;
      while (body && (body.name === 'TypeAnnotation' || body.name === '⚠')) body = body.nextSibling;
      if (body) walkFreeVarNode(builder, body, funcNode, funcBodyScope, funcScope, enclosingScope, freeVarUses, []);
    }
    return;
  }

  const block = funcNode.getChild('Block');
  if (block) {
    const bodyScope = blockScopeForAnalysis(builder, block, enclosingScope);
    registerFunctionBodyDeclarations(builder, block, bodyScope);
    walkFunctionBody(builder, block, funcNode, bodyScope, funcScope, enclosingScope, freeVarUses);
  }
}

function walkParamDefaults(
  builder: ScopeBuilder,
  paramList: SyntaxNode | null,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  enclosingScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  if (!paramList) return;

  let currentParam: SyntaxNode[] = [];
  const processParam = () => {
    for (const part of currentParam) {
      if (part.name !== 'Equals') continue;
      for (let init = part.nextSibling; init; init = init.nextSibling) {
        if (init.name === ',' || init.name === ')') break;
        walkFreeVarNode(builder, init, funcNode, currentScope, funcScope, enclosingScope, freeVarUses, [paramList]);
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
  enclosingScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;
    walkFunctionBodyNode(builder, child, funcNode, currentScope, funcScope, enclosingScope, freeVarUses);
  }
}

function walkFunctionBodyNode(
  builder: ScopeBuilder,
  node: SyntaxNode,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  enclosingScope: LexicalScope,
  freeVarUses: FreeVarUse[],
): void {
  if (node !== funcNode && FUNCTION_NODES.has(node.name)) return;

  if (node.name === 'Block') {
    const innerScope = blockScopeForAnalysis(builder, node, currentScope);
    walkFunctionBody(builder, node, funcNode, innerScope, funcScope, enclosingScope, freeVarUses);
    return;
  }

  if (node.name === 'VariableDeclaration') {
    walkDeclarationForFreeVars(builder, node, funcNode, currentScope, funcScope, enclosingScope, freeVarUses);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    if (node === funcNode) {
      const block = node.getChild('Block');
      if (block) walkFunctionBody(builder, block, funcNode, currentScope, funcScope, enclosingScope, freeVarUses);
    }
    return;
  }

  if (node.name === 'ForStatement') {
    const loopBlock = node.getChild('Block');
    const loopScope = loopBlock ? blockScopeForAnalysis(builder, loopBlock, currentScope) : currentScope;
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) {
      registerForSpec(spec, builder, loopScope);
      forEachForSpecExpression(spec, (expr) =>
        walkFreeVarNode(builder, expr, funcNode, loopScope, funcScope, enclosingScope, freeVarUses, []),
      );
    }
    const block = node.getChild('Block');
    if (block) walkFunctionBody(builder, block, funcNode, loopScope, funcScope, enclosingScope, freeVarUses);
    return;
  }

  if (node.name === 'CatchClause') {
    const catchBlock = node.getChild('Block');
    const catchScope = catchBlock ? blockScopeForAnalysis(builder, catchBlock, currentScope) : currentScope;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') builder.addBinding(catchScope, nodeText(child, builder.source), 'block');
      else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        addPatternBindings(child, builder, catchScope, 'block');
      } else if (child.name === 'Block') {
        walkFunctionBody(builder, child, funcNode, catchScope, funcScope, enclosingScope, freeVarUses);
      }
    }
    return;
  }

  walkFreeVarNode(builder, node, funcNode, currentScope, funcScope, enclosingScope, freeVarUses, []);
}

function walkDeclarationForFreeVars(
  builder: ScopeBuilder,
  node: SyntaxNode,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope,
  enclosingScope: LexicalScope,
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
        walkFreeVarNode(builder, init, funcNode, currentScope, funcScope, enclosingScope, freeVarUses, [node]);
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

function functionDeclaresParam(funcNode: SyntaxNode, name: string, source: string): boolean {
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

// Finds the nearest function that encloses `funcNode` and declares `name` as one of
// its parameters. Such a parameter is a free variable inside the closure (`funcNode`)
// because closures are serialized and re-evaluated in isolation, so it must be
// threaded through the owner's scope object rather than relying on JS lexical capture.
function enclosingFunctionParamOwner(
  name: string,
  varNode: SyntaxNode,
  funcNode: SyntaxNode,
  source: string,
): SyntaxNode | null {
  let node: SyntaxNode | null = varNode.parent;
  while (node) {
    if (
      node !== funcNode &&
      ALL_FUNCTION_NODES.has(node.name) &&
      node.from <= funcNode.from &&
      node.to >= funcNode.to &&
      functionDeclaresParam(node, name, source)
    ) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

// Property name used to thread a captured `this` through a scope object. `this` is a
// reserved word, so no user identifier can collide with it; it must not start with `$`,
// since the heap-storage layer treats `$`-prefixed keys as reserved and refuses to store
// them (which would make the captured receiver read back as undefined).
const THIS_BINDING = 'this';

// Finds the nearest function that lexically owns `funcNode`'s `this`. Arrow functions
// inherit `this` lexically, so we skip them and return the closest enclosing regular
// (non-arrow) function — the one whose `this` is established at call time via apply.
function enclosingThisOwner(funcNode: SyntaxNode): SyntaxNode | null {
  let node: SyntaxNode | null = funcNode.parent;
  while (node) {
    if (node.name === 'FunctionDeclaration' || node.name === 'FunctionExpression') return node;
    node = node.parent;
  }
  return null;
}

function findScopeByBlockNode(builder: ScopeBuilder, block: SyntaxNode): LexicalScope | null {
  // SyntaxNode objects are not reference-equal across getChild() calls, so match on the
  // block's source span instead of identity.
  for (const scope of builder.scopes) {
    if (scope.blockNode && scope.blockNode.from === block.from && scope.blockNode.to === block.to) {
      return scope;
    }
  }
  return null;
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
  enclosingScope: LexicalScope,
  freeVarUses: FreeVarUse[],
  ancestors: SyntaxNode[],
): void {
  if (node !== funcNode && FUNCTION_NODES.has(node.name)) return;

  if (node.name === 'this') {
    // A regular function's own `this` is set by apply at call time, so it stays bare.
    // Inside an arrow it must be threaded: promote it onto the owning regular function's
    // body scope and rewrite the reference to `$scopeN.$this`.
    if (funcNode.name === 'ArrowFunction') {
      const owner = enclosingThisOwner(funcNode);
      const ownerBlock = owner?.getChild('Block') ?? null;
      const ownerScope = ownerBlock ? findScopeByBlockNode(builder, ownerBlock) : null;
      if (ownerScope) {
        if (!ownerScope.bindings.has(THIS_BINDING)) builder.addBinding(ownerScope, THIS_BINDING, 'block');
        ownerScope.freeVarBindings.add(THIS_BINDING);
        ownerScope.capturedThis = true;
        freeVarUses.push({ name: THIS_BINDING, scope: ownerScope, from: node.from, to: node.to, funcNode });
      }
    }
    return;
  }

  if (node.name === 'VariableName') {
    const name = nodeText(node, builder.source);
    if (!shouldRewriteToWorld(name)) return;
    const binding = resolveInFunction(builder, name, currentScope, funcScope);
    if (
      binding &&
      isGlobalFunctionSelfRef(name, binding, funcNode, funcScope, enclosingScope, builder.source)
    ) {
      freeVarUses.push({
        name,
        scope: binding.scope,
        from: node.from,
        to: node.to,
        funcNode,
        world: true,
      });
      return;
    }
    if (
      binding?.kind === 'function' &&
      binding.scope === funcScope &&
      isOwnFunctionNameMemberAccess(node, funcNode, builder.source)
    ) {
      freeVarUses.push({
        name,
        scope: binding.scope,
        from: node.from,
        to: node.to,
        funcNode,
        world: true,
      });
      return;
    }
    if (
      binding?.kind === 'function' &&
      functionDeclaredName(funcNode, builder.source) === name &&
      !isRootScope(binding.scope)
    ) {
      return;
    }
    if (binding?.kind === 'function' && binding.scope === funcScope) {
      return;
    }
    if (binding?.kind === 'function' && binding.scope === currentScope) {
      return;
    }
    if (
      binding?.kind === 'function' &&
      !isRootScope(binding.scope) &&
      binding.scope !== funcScope
    ) {
      binding.scope.freeVarBindings.add(name);
      freeVarUses.push({ name, scope: binding.scope, from: node.from, to: node.to, funcNode });
      return;
    }
    if (binding && (binding.scope === funcScope || isAncestorScope(funcScope, binding.scope))) return;
    // A binding declared lexically inside the current function is a local, not a
    // captured free variable, even when the reference sits in a deeper block (e.g.
    // a for-loop body). The current function's body scope is parented to the
    // enclosing scope rather than funcScope, so isAncestorScope above misses it.
    if (binding && scopeIsCreatedInFunction(binding.scope, funcNode)) return;

    // A parameter of an enclosing function referenced inside this closure is a captured
    // free variable. Promote it onto the owner function's body scope object and seed it
    // there, so the closure reads it through `$scopeN.p` rather than relying on JS
    // lexical scoping (which serialized closures don't have).
    const paramOwner = enclosingFunctionParamOwner(name, node, funcNode, builder.source);
    if (paramOwner) {
      const ownerBlock = paramOwner.getChild('Block');
      const ownerScope = ownerBlock ? findScopeByBlockNode(builder, ownerBlock) : null;
      if (ownerScope) {
        if (!ownerScope.bindings.has(name)) builder.addBinding(ownerScope, name, 'block');
        ownerScope.freeVarBindings.add(name);
        ownerScope.capturedParams.add(name);
        freeVarUses.push({ name, scope: ownerScope, from: node.from, to: node.to, funcNode });
      }
      // Owner has no block body (e.g. expression-bodied arrow); leave the reference bare.
      return;
    }

    if (binding?.kind === 'param') return;
    if (isClosedOverByEnclosingFunction(name, node, funcNode, builder.source)) return;

    if (binding?.kind === 'block' && !isRootScope(binding.scope) && binding.scope !== currentScope) {
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
    const innerScope = blockScopeForAnalysis(builder, node, currentScope);
    walkFunctionBody(builder, node, funcNode, innerScope, funcScope, enclosingScope, freeVarUses);
    return;
  }

  if (node.name === 'VariableDeclaration') {
    walkDeclarationForFreeVars(builder, node, funcNode, currentScope, funcScope, enclosingScope, freeVarUses);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    return;
  }

  if (node.name === 'ForStatement' || node.name === 'CatchClause') {
    walkFunctionBodyNode(builder, node, funcNode, currentScope, funcScope, enclosingScope, freeVarUses);
    return;
  }

  const nextAncestors = [...ancestors, node];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkFreeVarNode(builder, child, funcNode, currentScope, funcScope, enclosingScope, freeVarUses, nextAncestors);
  }
}

function functionBlockNode(funcNode: SyntaxNode): SyntaxNode | null {
  return funcNode.getChild('Block');
}

function nodeContains(outer: SyntaxNode, inner: SyntaxNode): boolean {
  return inner.from >= outer.from && inner.to <= outer.to;
}

function scopeIsCreatedInFunction(scope: LexicalScope, funcNode: SyntaxNode): boolean {
  const block = functionBlockNode(funcNode);
  if (!block || !scope.blockNode) return false;
  return nodeContains(block, scope.blockNode);
}

function functionDirectlyContainsFunction(outer: SyntaxNode, inner: SyntaxNode): boolean {
  if (outer.from === inner.from && outer.to === inner.to) return false;
  const block = functionBlockNode(outer);
  if (block) return nodeContains(block, inner);
  return nodeContains(outer, inner);
}

function directScopesForFunction(freeVarUses: FreeVarUse[], funcNode: SyntaxNode): Set<LexicalScope> {
  const scopeSet = new Set<LexicalScope>();
  for (const use of freeVarUses) {
    if (use.funcNode.from !== funcNode.from || use.funcNode.to !== funcNode.to) continue;
    if (use.scope.needsObject() && !scopeIsCreatedInFunction(use.scope, funcNode)) {
      scopeSet.add(use.scope);
    }
  }
  return scopeSet;
}

function scopesForFunction(
  freeVarUses: FreeVarUse[],
  funcNode: SyntaxNode,
  allFunctions: FunctionTarget[],
): LexicalScope[] {
  const scopeSet = directScopesForFunction(freeVarUses, funcNode);

  for (const target of allFunctions) {
    if (!functionDirectlyContainsFunction(funcNode, target.node)) continue;
    for (const scope of scopesForFunction(freeVarUses, target.node, allFunctions)) {
      if (!scopeIsCreatedInFunction(scope, funcNode)) scopeSet.add(scope);
    }
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

function declarationDeclaresScopedName(
  node: SyntaxNode,
  source: string,
  scopedNames: Set<string>,
): boolean {
  for (const name of scopedNames) {
    if (declarationContainsBinding(node, source, name)) return true;
  }
  return false;
}

function findBindingDeclaration(blockNode: SyntaxNode, source: string, bindingName: string): SyntaxNode | null {
  for (let child = blockNode.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'VariableDeclaration') continue;
    if (declarationContainsBinding(child, source, bindingName)) return child;
  }
  return null;
}

function forStatementForLoopBodyScope(scope: LexicalScope): SyntaxNode | null {
  const block = scope.blockNode;
  if (!block || block.parent?.name !== 'ForStatement') return null;
  return block.parent;
}

function findForSpecBindingDeclaration(forStmt: SyntaxNode, source: string, bindingName: string): SyntaxNode | null {
  const spec = forStmt.getChild('ForSpec') ?? forStmt.getChild('ForInSpec') ?? forStmt.getChild('ForOfSpec');
  if (!spec) return null;
  for (let child = spec.firstChild; child; child = child.nextSibling) {
    if (child.name === 'VariableDeclaration' && declarationContainsBinding(child, source, bindingName)) {
      return child;
    }
  }
  return null;
}

function lineIndent(source: string, pos: number): string {
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  return source.slice(lineStart, pos);
}

function bindingResolvesToScopedName(
  builder: ScopeBuilder,
  name: string,
  currentScope: LexicalScope,
  targetScope: LexicalScope,
  scopedNames: Set<string>,
): boolean {
  if (!scopedNames.has(name)) return false;
  return builder.resolve(name, currentScope)?.scope === targetScope;
}

function scopedMemberRef(
  source: string,
  from: number,
  to: number,
  name: string,
  scopeName: string,
): string {
  const member = `${scopeName}.${name}`;
  return isReferenceUsedAsCallCallee(source, from, to) ? `(${member})` : member;
}

function collectForSpecScopedRefEdits(
  builder: ScopeBuilder,
  forStmt: SyntaxNode,
  scope: LexicalScope,
  scopedNames: Set<string>,
  edits: Edit[],
): void {
  const spec = forStmt.getChild('ForSpec') ?? forStmt.getChild('ForInSpec') ?? forStmt.getChild('ForOfSpec');
  if (!spec) return;
  forEachForSpecExpression(spec, (expr) =>
    walkScopedBindingRefs(builder, expr, scope, scope, scopedNames, edits),
  );
}

function collectBlockScopedRefEdits(
  builder: ScopeBuilder,
  blockNode: SyntaxNode,
  scope: LexicalScope,
  scopedNames: Set<string>,
  edits: Edit[],
): void {
  for (let child = blockNode.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;
    walkBlockScopedRefs(builder, child, scope, scope, scopedNames, edits);
  }
}

function walkBlockScopedRefs(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  targetScope: LexicalScope,
  scopedNames: Set<string>,
  edits: Edit[],
): void {
  if (FUNCTION_NODES.has(node.name) || node.name === 'FunctionDeclaration') return;

  if (node.name === 'VariableDeclaration') {
    // A declaration bound for the wholesale rewrite (transformBindingDeclaration
    // re-slices its initializers, rewriting scoped refs itself) must be skipped here
    // to avoid overlapping edits. In-place-rewritten declarations keep their
    // initializer ranges intact, so those initializers fall through to the normal
    // scoped-reference walk below.
    if (
      declarationDeclaresScopedName(node, builder.source, scopedNames) &&
      declUsesWholesaleTransform(node, builder.source, scopedNames)
    ) {
      return;
    }
    // Plain and in-place-rewritten declarations: initializer expressions still
    // need references to scoped bindings rewritten (e.g. `let t = maxW + 1`).
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== 'Equals') continue;
      for (let init = child.nextSibling; init; init = init.nextSibling) {
        if (init.name === ';' || init.name === ',') break;
        walkScopedBindingRefs(builder, init, currentScope, targetScope, scopedNames, edits);
      }
    }
    return;
  }

  if (node.name === 'Block') {
    const innerScope = blockScopeForAnalysis(builder, node, currentScope);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === '{' || child.name === '}') continue;
      walkBlockScopedRefs(builder, child, innerScope, targetScope, scopedNames, edits);
    }
    return;
  }

  if (node.name === 'ForStatement') {
    const loopBlock = node.getChild('Block');
    const loopScope = loopBlock ? blockScopeForAnalysis(builder, loopBlock, currentScope) : currentScope;
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) {
      forEachForSpecExpression(spec, (expr) =>
        walkScopedBindingRefs(builder, expr, loopScope, targetScope, scopedNames, edits),
      );
    }
    if (loopBlock) {
      for (let child = loopBlock.firstChild; child; child = child.nextSibling) {
        if (child.name === '{' || child.name === '}') continue;
        walkBlockScopedRefs(builder, child, loopScope, targetScope, scopedNames, edits);
      }
    }
    return;
  }

  if (node.name === 'CatchClause') {
    const catchBlock = node.getChild('Block');
    const catchScope = catchBlock ? blockScopeForAnalysis(builder, catchBlock, currentScope) : currentScope;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        continue;
      }
      if (child.name === 'Block') {
        for (let blockChild = child.firstChild; blockChild; blockChild = blockChild.nextSibling) {
          if (blockChild.name === '{' || blockChild.name === '}') continue;
          walkBlockScopedRefs(builder, blockChild, catchScope, targetScope, scopedNames, edits);
        }
      }
    }
    return;
  }

  walkScopedBindingRefs(builder, node, currentScope, targetScope, scopedNames, edits);
}

function walkScopedBindingRefs(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  targetScope: LexicalScope,
  scopedNames: Set<string>,
  edits: Edit[],
): void {
  if (FUNCTION_NODES.has(node.name) || node.name === 'FunctionDeclaration') return;

  if (node.name === 'AssignmentExpression') {
    const lhs = node.firstChild;
    if (lhs?.name === 'VariableName') {
      const name = nodeText(lhs, builder.source);
      if (bindingResolvesToScopedName(builder, name, currentScope, targetScope, scopedNames)) {
        edits.push({
          kind: 'replace',
          from: lhs.from,
          to: lhs.to,
          text: scopedMemberRef(builder.source, lhs.from, lhs.to, name, targetScope.name),
        });
      }
    } else if (lhs) {
      walkScopedBindingRefs(builder, lhs, currentScope, targetScope, scopedNames, edits);
    }
    const rhs = node.lastChild;
    if (rhs && rhs !== lhs) walkScopedBindingRefs(builder, rhs, currentScope, targetScope, scopedNames, edits);
    return;
  }

  if (node.name === 'UpdateExpression') {
    const varName = node.getChild('VariableName');
    if (varName) {
      const name = nodeText(varName, builder.source);
      if (bindingResolvesToScopedName(builder, name, currentScope, targetScope, scopedNames)) {
        edits.push({
          kind: 'replace',
          from: varName.from,
          to: varName.to,
          text: scopedMemberRef(builder.source, varName.from, varName.to, name, targetScope.name),
        });
      }
    }
    return;
  }

  if (node.name === 'VariableName') {
    const name = nodeText(node, builder.source);
    if (bindingResolvesToScopedName(builder, name, currentScope, targetScope, scopedNames)) {
      edits.push({
        kind: 'replace',
        from: node.from,
        to: node.to,
        text: scopedMemberRef(builder.source, node.from, node.to, name, targetScope.name),
      });
    }
    return;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkScopedBindingRefs(builder, child, currentScope, targetScope, scopedNames, edits);
  }
}

function isWorldFreeVarRef(freeVarUses: FreeVarUse[], from: number, to: number): boolean {
  return freeVarUses.some((use) => use.from === from && use.to === to && use.world);
}

function rewriteInitExprGlobalRefs(
  builder: ScopeBuilder,
  expr: SyntaxNode,
  declBlockScope: LexicalScope,
  scopeName: string,
  scopedNames: Set<string>,
  freeVarUses: FreeVarUse[],
): string {
  const edits: Edit[] = [];
  walkInitExprGlobalRefs(builder, expr, declBlockScope, scopeName, scopedNames, freeVarUses, edits);
  const replacements = edits.filter(
    (edit): edit is Extract<Edit, { kind: 'replace' }> => edit.kind === 'replace',
  );
  if (replacements.length === 0) {
    return builder.source.slice(expr.from, expr.to);
  }
  replacements.sort((a, b) => b.from - a.from);
  let text = builder.source.slice(expr.from, expr.to);
  for (const edit of replacements) {
    const start = edit.from - expr.from;
    const end = edit.to - expr.from;
    text = text.slice(0, start) + edit.text + text.slice(end);
  }
  return text;
}

function walkInitExprGlobalRefs(
  builder: ScopeBuilder,
  node: SyntaxNode,
  declBlockScope: LexicalScope,
  scopeName: string,
  scopedNames: Set<string>,
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  if (node.name === 'VariableName') {
    const name = nodeText(node, builder.source);
    if (!shouldRewriteToWorld(name)) return;
    if (bindingResolvesToScopedName(builder, name, declBlockScope, declBlockScope, scopedNames)) {
      edits.push({
        kind: 'replace',
        from: node.from,
        to: node.to,
        text: scopedMemberRef(builder.source, node.from, node.to, name, scopeName),
      });
      return;
    }
    if (isWorldFreeVarRef(freeVarUses, node.from, node.to)) {
      edits.push({ kind: 'replace', from: node.from, to: node.to, text: `$global.${name}` });
      return;
    }
    const binding = builder.resolve(name, declBlockScope);
    if (binding && isRootScope(binding.scope)) {
      edits.push({ kind: 'replace', from: node.from, to: node.to, text: `$global.${name}` });
    }
    return;
  }
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkInitExprGlobalRefs(builder, child, declBlockScope, scopeName, scopedNames, freeVarUses, edits);
  }
}

function renderScopeAssignment(
  builder: ScopeBuilder,
  bindingNode: SyntaxNode,
  blockScope: LexicalScope,
  scopeName: string,
  bindingName: string,
  scopedNames: Set<string>,
  freeVarUses: FreeVarUse[],
): string {
  let init = bindingNode.nextSibling;
  while (init && init.name !== 'Equals') init = init.nextSibling;
  if (!init || init.name !== 'Equals') return `${scopeName}.${bindingName} = undefined`;
  let expr = init.nextSibling;
  if (!expr || expr.name === ',' || expr.name === ';') return `${scopeName}.${bindingName} = undefined`;
  return `${scopeName}.${bindingName} = ${rewriteInitExprGlobalRefs(builder, expr, blockScope, scopeName, scopedNames, freeVarUses)}`;
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

/** True when a captured declaration must be rewritten wholesale (text replacement of
 * the entire statement) rather than with in-place per-declarator edits: inside a
 * for-spec (statement separators are illegal there) or when a destructuring pattern
 * binds a captured name (there is no single `$scopeN.x = init` form for it). The
 * wholesale path re-slices initializer text from the original source, so nested
 * literal/function wraps are lost there — the in-place path is preferred. */
function declUsesWholesaleTransform(
  declNode: SyntaxNode,
  source: string,
  scopedBindings: Set<string>,
): boolean {
  const keyword = declarationKeyword(declNode, source);
  if (!keyword || keyword === 'var') return true;
  const parentName = declNode.parent?.name;
  if (parentName === 'ForSpec' || parentName === 'ForInSpec' || parentName === 'ForOfSpec') {
    return true;
  }
  for (let child = declNode.firstChild; child; child = child.nextSibling) {
    if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      const names = new Set<string>();
      collectPatternBindings(child, source, names);
      for (const name of names) {
        if (scopedBindings.has(name)) return true;
      }
    }
  }
  return false;
}

function declaratorHasInitializer(bindingNode: SyntaxNode): boolean {
  for (let n = bindingNode.nextSibling; n && n.name !== ',' && n.name !== ';'; n = n.nextSibling) {
    if (n.name === 'Equals') return true;
  }
  return false;
}

/** Rewrite a declaration binding captured names via small in-place edits that leave
 * every initializer expression untouched, so nested `$arr`/`$obj`/`$fun` wraps and
 * free-variable rewrites inside the initializers survive:
 *   `let a = 1, xs = [], b = 2;` → `let a = 1; $scopeN.xs = $arr([]); let b = 2;` */
function collectInPlaceDeclarationEdits(
  builder: ScopeBuilder,
  declNode: SyntaxNode,
  scopeName: string,
  scopedBindings: Set<string>,
  edits: Edit[],
): void {
  const source = builder.source;
  const keyword = declarationKeyword(declNode, source);
  if (!keyword) return;

  let prefixFrom = declNode.from; // start of the `let `/`, ` segment before the next declarator
  let prefixIsComma = false;
  let prevWasScoped = false;
  for (let child = declNode.firstChild; child; child = child.nextSibling) {
    if (child.name === ',') {
      prefixFrom = child.from;
      prefixIsComma = true;
      continue;
    }
    const isBinding =
      child.name === 'VariableDefinition' ||
      child.name === 'ObjectPattern' ||
      child.name === 'ArrayPattern';
    if (!isBinding) continue;

    const name = child.name === 'VariableDefinition' ? nodeText(child, source) : null;
    if (name !== null && scopedBindings.has(name)) {
      const init = declaratorHasInitializer(child) ? '' : ' = undefined';
      edits.push({
        kind: 'replace',
        from: prefixFrom,
        to: child.to,
        text: `${prefixIsComma ? '; ' : ''}${scopeName}.${name}${init}`,
      });
      prevWasScoped = true;
    } else {
      // A local declarator after a captured one needs its keyword restored:
      // the `,` that linked it to the (now separate) scope assignment becomes `; let`.
      if (prevWasScoped && prefixIsComma) {
        edits.push({ kind: 'replace', from: prefixFrom, to: prefixFrom + 1, text: `; ${keyword}` });
      }
      prevWasScoped = false;
    }
    prefixIsComma = false;
  }
}

function transformBindingDeclaration(
  builder: ScopeBuilder,
  declNode: SyntaxNode,
  blockScope: LexicalScope,
  scopeName: string,
  scopedBindings: Set<string>,
  allScopedNames: Set<string>,
  freeVarUses: FreeVarUse[],
): string | null {
  const source = builder.source;
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
          statements.push(renderScopeAssignment(builder, pending, blockScope, scopeName, name, allScopedNames, freeVarUses));
          transformedAny = true;
        } else {
          localDeclarators.push(renderDeclaratorText(source, pending));
        }
      } else {
        const names = new Set<string>();
        collectPatternBindings(pending, source, names);
        for (const name of names) {
          if (!scopedBindings.has(name)) continue;
          statements.push(renderScopeAssignment(builder, pending, blockScope, scopeName, name, allScopedNames, freeVarUses));
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

  return applyEdits(source, edits, []);
}

function walkForWorldRefs(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope | null,
  rootScope: LexicalScope,
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  if (FUNCTION_NODES.has(node.name)) {
    if (!isDoNotTranspileFunction(node, builder.source)) {
      walkFunctionForWorldRefs(builder, node, currentScope, rootScope, freeVarUses, edits);
    }
    return;
  }

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
    } else if (lhs && isRootScope(currentScope)) {
      walkForWorldRefs(builder, lhs, currentScope, funcScope, rootScope, freeVarUses, edits);
    }
    const rhs = node.lastChild;
    if (rhs && rhs !== lhs) walkForWorldRefs(builder, rhs, currentScope, funcScope, rootScope, freeVarUses, edits);
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
    if (freeVarUses.some((use) => use.from === node.from && use.to === node.to && !use.world)) return;
    const binding = funcScope
      ? resolveInFunction(builder, name, currentScope, funcScope)
      : builder.resolve(name, currentScope);
    if (funcScope) {
      if (isWorldFreeVarRef(freeVarUses, node.from, node.to)) {
        edits.push({ kind: 'replace', from: node.from, to: node.to, text: `$global.${name}` });
        return;
      }
      if (binding && !isRootScope(binding.scope)) return;
      if (binding && isRootScope(binding.scope) && shouldRewriteToWorld(name)) {
        edits.push({ kind: 'replace', from: node.from, to: node.to, text: `$global.${name}` });
      }
      return;
    }
    if (binding && !isRootScope(binding.scope)) return;
    edits.push({ kind: 'replace', from: node.from, to: node.to, text: `$global.${name}` });
    return;
  }

  if (node.name === 'Block') {
    const innerScope = blockScopeForAnalysis(builder, node, currentScope);
    registerFunctionBodyDeclarations(builder, node, innerScope);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === '{' || child.name === '}') continue;
      walkForWorldRefsInBlock(builder, child, innerScope, funcScope, rootScope, freeVarUses, edits);
    }
    return;
  }

  if (node.name === 'VariableDeclaration') {
    registerDeclarationForWorldWalk(builder, node, currentScope, funcScope, rootScope, freeVarUses, edits);
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    if (!isDoNotTranspileFunction(node, builder.source)) {
      walkFunctionForWorldRefs(builder, node, currentScope, rootScope, freeVarUses, edits);
    }
    return;
  }

  if (node.name === 'ForStatement') {
    const loopBlock = node.getChild('Block');
    const loopScope = loopBlock ? blockScopeForAnalysis(builder, loopBlock, currentScope) : currentScope;
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) {
      registerForSpec(spec, builder, loopScope);
      forEachForSpecExpression(spec, (expr) =>
        walkForWorldRefs(builder, expr, loopScope, funcScope, rootScope, freeVarUses, edits),
      );
    }
    if (loopBlock) walkBlockForWorldRefs(builder, loopBlock, loopScope, funcScope ?? loopScope, rootScope, freeVarUses, edits);
    return;
  }

  if (node.name === 'CatchClause') {
    const catchBlock = node.getChild('Block');
    const catchScope = catchBlock ? blockScopeForAnalysis(builder, catchBlock, currentScope) : currentScope;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') {
        builder.addBinding(catchScope, nodeText(child, builder.source), 'block');
      } else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        addPatternBindings(child, builder, catchScope, 'block');
      } else if (child.name === 'Block') {
        walkBlockForWorldRefs(builder, child, catchScope, funcScope ?? catchScope, rootScope, freeVarUses, edits);
      }
    }
    return;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkForWorldRefs(builder, child, currentScope, funcScope, rootScope, freeVarUses, edits);
  }
}

function walkFunctionForWorldRefs(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  currentScope: LexicalScope,
  rootScope: LexicalScope,
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  const enclosingScope = findEnclosingScopeForFunction(builder, funcNode, rootScope);
  const innerFuncScope = buildFunctionScope(builder, funcNode, enclosingScope);
  const block = funcNode.getChild('Block');
  if (block) {
    const bodyScope = blockScopeForAnalysis(builder, block, enclosingScope);
    registerFunctionBodyDeclarations(builder, block, bodyScope);
    walkBlockForWorldRefs(builder, block, bodyScope, innerFuncScope, rootScope, freeVarUses, edits);
    return;
  }
  if (funcNode.name === 'ArrowFunction') {
    let body: SyntaxNode | null = funcNode.getChild('Arrow')?.nextSibling ?? null;
    while (body && (body.name === 'TypeAnnotation' || body.name === '⚠')) body = body.nextSibling;
    if (body) walkForWorldRefs(builder, body, innerFuncScope, innerFuncScope, rootScope, freeVarUses, edits);
  }
}

function registerDeclarationForWorldWalk(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope | null,
  rootScope: LexicalScope,
  freeVarUses: FreeVarUse[],
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
        walkForWorldRefs(builder, init, currentScope, funcScope, rootScope, freeVarUses, edits);
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
  rootScope: LexicalScope,
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  for (let child = block.firstChild; child; child = child.nextSibling) {
    if (child.name === '{' || child.name === '}') continue;
    walkForWorldRefsInBlock(builder, child, currentScope, funcScope, rootScope, freeVarUses, edits);
  }
}

function walkForWorldRefsInBlock(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  funcScope: LexicalScope | null,
  rootScope: LexicalScope,
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  if (FUNCTION_NODES.has(node.name)) return;

  walkForWorldRefs(builder, node, currentScope, funcScope, rootScope, freeVarUses, edits);
}

function collectWorldRefEdits(
  builder: ScopeBuilder,
  rootScope: LexicalScope,
  topNode: SyntaxNode,
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  for (let child = topNode.firstChild; child; child = child.nextSibling) {
    walkForWorldRefsInBlock(builder, child, rootScope, null, rootScope, freeVarUses, edits);
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
  if (isInsideDoNotTranspileFunction(ancestors, source)) return;

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

function isReferenceUsedAsCallCallee(source: string, from: number, to: number): boolean {
  let i = to;
  while (i < source.length && /\s/.test(source[i] ?? '')) i++;
  return source[i] === '(';
}

function scopeForScopedFunctionDecl(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  declName: string,
  freeVarUses: FreeVarUse[],
): LexicalScope | null {
  for (const use of freeVarUses) {
    if (use.name !== declName || use.world) continue;
    if (!use.scope.needsObject() || !use.scope.blockNode) continue;
    if (!nodeContains(use.scope.blockNode, funcNode)) continue;
    const binding = builder.resolve(declName, use.scope);
    if (binding?.scope === use.scope && binding.kind === 'function') {
      return use.scope;
    }
  }
  return null;
}

function scopeNameForScopedFunctionDecl(
  builder: ScopeBuilder,
  funcNode: SyntaxNode,
  declName: string,
  freeVarUses: FreeVarUse[],
): string | null {
  return scopeForScopedFunctionDecl(builder, funcNode, declName, freeVarUses)?.name ?? null;
}

function supplementScopedFunctionUses(
  builder: ScopeBuilder,
  functions: FunctionTarget[],
  freeVarUses: FreeVarUse[],
): void {
  const existingPositions = new Set(freeVarUses.map((use) => `${use.from}:${use.to}`));

  for (const target of functions) {
    if (target.kind !== 'decl') continue;
    const scopeObj = scopeForScopedFunctionDecl(builder, target.node, target.declName!, freeVarUses);
    if (!scopeObj?.blockNode) continue;

    walkScopeBlockForFunctionRefs(
      builder,
      scopeObj.blockNode,
      scopeObj,
      target.declName!,
      scopeObj,
      existingPositions,
      freeVarUses,
      target.node,
    );
  }
}

function walkScopeBlockForFunctionRefs(
  builder: ScopeBuilder,
  node: SyntaxNode,
  currentScope: LexicalScope,
  declName: string,
  targetScope: LexicalScope,
  existingPositions: Set<string>,
  freeVarUses: FreeVarUse[],
  funcNode: SyntaxNode,
): void {
  if (node.name === 'VariableName') {
    if (nodeText(node, builder.source) !== declName) return;
    const key = `${node.from}:${node.to}`;
    if (existingPositions.has(key)) return;
    const binding = builder.resolve(declName, currentScope);
    if (binding?.scope !== targetScope || binding.kind !== 'function') return;
    targetScope.freeVarBindings.add(declName);
    freeVarUses.push({
      name: declName,
      scope: targetScope,
      from: node.from,
      to: node.to,
      funcNode,
    });
    existingPositions.add(key);
    return;
  }

  if (node.name === 'Block') {
    const innerScope =
      node === targetScope.blockNode
        ? targetScope
        : blockScopeForAnalysis(builder, node, currentScope);
    registerFunctionBodyDeclarations(builder, node, innerScope);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === '{' || child.name === '}') continue;
      walkScopeBlockForFunctionRefs(
        builder,
        child,
        innerScope,
        declName,
        targetScope,
        existingPositions,
        freeVarUses,
        funcNode,
      );
    }
    return;
  }

  if (node.name === 'FunctionDeclaration') {
    const block = node.getChild('Block');
    if (block) {
      const bodyScope = blockScopeForAnalysis(builder, block, currentScope);
      for (let child = block.firstChild; child; child = child.nextSibling) {
        if (child.name === '{' || child.name === '}') continue;
        walkScopeBlockForFunctionRefs(
          builder,
          child,
          bodyScope,
          declName,
          targetScope,
          existingPositions,
          freeVarUses,
          funcNode,
        );
      }
    }
    return;
  }

  if (node.name === 'ForStatement') {
    const loopBlock = node.getChild('Block');
    const loopScope = loopBlock ? blockScopeForAnalysis(builder, loopBlock, currentScope) : currentScope;
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) registerForSpec(spec, builder, loopScope);
    if (loopBlock) {
      for (let child = loopBlock.firstChild; child; child = child.nextSibling) {
        if (child.name === '{' || child.name === '}') continue;
        walkScopeBlockForFunctionRefs(
          builder,
          child,
          loopScope,
          declName,
          targetScope,
          existingPositions,
          freeVarUses,
          funcNode,
        );
      }
    }
    return;
  }

  if (node.name === 'CatchClause') {
    const catchBlock = node.getChild('Block');
    const catchScope = catchBlock ? blockScopeForAnalysis(builder, catchBlock, currentScope) : currentScope;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'VariableDefinition') {
        builder.addBinding(catchScope, nodeText(child, builder.source), 'block');
      } else if (child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
        addPatternBindings(child, builder, catchScope, 'block');
      } else if (child.name === 'Block') {
        for (let blockChild = child.firstChild; blockChild; blockChild = blockChild.nextSibling) {
          if (blockChild.name === '{' || blockChild.name === '}') continue;
          walkScopeBlockForFunctionRefs(
            builder,
            blockChild,
            catchScope,
            declName,
            targetScope,
            existingPositions,
            freeVarUses,
            funcNode,
          );
        }
      }
    }
    return;
  }

  if (FUNCTION_NODES.has(node.name)) {
    const block = node.getChild('Block');
    if (block) {
      const bodyScope = blockScopeForAnalysis(builder, block, currentScope);
      for (let child = block.firstChild; child; child = child.nextSibling) {
        if (child.name === '{' || child.name === '}') continue;
        walkScopeBlockForFunctionRefs(
          builder,
          child,
          bodyScope,
          declName,
          targetScope,
          existingPositions,
          freeVarUses,
          funcNode,
        );
      }
      return;
    }
    let body: SyntaxNode | null = node.getChild('Arrow')?.nextSibling ?? null;
    while (body && (body.name === 'TypeAnnotation' || body.name === '⚠')) body = body.nextSibling;
    if (body) {
      walkScopeBlockForFunctionRefs(
        builder,
        body,
        currentScope,
        declName,
        targetScope,
        existingPositions,
        freeVarUses,
        funcNode,
      );
    }
    return;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    walkScopeBlockForFunctionRefs(
      builder,
      child,
      currentScope,
      declName,
      targetScope,
      existingPositions,
      freeVarUses,
      funcNode,
    );
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
    if (binding?.scope === scope && (binding.kind === 'block' || binding.kind === 'function')) {
      names.add(use.name);
    }
  }
  return names;
}

function collectScopeEdits(builder: ScopeBuilder, freeVarUses: FreeVarUse[], edits: Edit[]): void {
  type DeclTransform = {
    declNode: SyntaxNode;
    blockScope: LexicalScope;
    scopeName: string;
    bindings: Set<string>;
    allScopedNames: Set<string>;
  };
  const declTransforms = new Map<string, DeclTransform>();

  for (const scope of builder.scopes) {
    if (!scope.needsObject() || !scope.blockNode || isRootScope(scope)) continue;

    const forStmt = forStatementForLoopBodyScope(scope);
    if (forStmt) {
      const indent = lineIndent(builder.source, forStmt.from);
      edits.push({
        kind: 'insert',
        pos: forStmt.from,
        text: `const ${scope.name} = $obj({});\n${indent}`,
      });
    } else {
      const openBrace = scope.blockNode.firstChild;
      if (openBrace?.name === '{') {
        edits.push({ kind: 'insert', pos: openBrace.to, text: `\n  const ${scope.name} = $obj({});` });
      } else if (!scope.parent) {
        edits.push({ kind: 'insert', pos: 0, text: `const ${scope.name} = $obj({});\n` });
      }
    }

    const scopedNames = collectScopedBindingNames(builder, scope, freeVarUses);

    // Captured parameters have no declaration to transform into a scope assignment, so
    // seed them explicitly at the top of the body: `$scopeN.p = p;`. The right-hand side
    // reads the still-intact signature parameter; because this is inserted text it is not
    // re-walked, so it is never rewritten to `$scopeN.p`.
    const openBraceForSeed = scope.blockNode.firstChild;
    if (openBraceForSeed?.name === '{') {
      for (const paramName of scope.capturedParams) {
        if (!scopedNames.has(paramName)) continue;
        edits.push({
          kind: 'insert',
          pos: openBraceForSeed.to,
          text: `\n  ${scope.name}.${paramName} = ${paramName};`,
        });
      }
      // Seed the captured `this` from the still-bare receiver. Inserted text is not
      // re-walked, so the right-hand `this` is never rewritten to `$scopeN.$this`.
      if (scope.capturedThis) {
        edits.push({
          kind: 'insert',
          pos: openBraceForSeed.to,
          text: `\n  ${scope.name}.${THIS_BINDING} = this;`,
        });
      }
    }

    for (const bindingName of scopedNames) {
      let declNode = findBindingDeclaration(scope.blockNode, builder.source, bindingName);
      if (!declNode && forStmt) {
        declNode = findForSpecBindingDeclaration(forStmt, builder.source, bindingName);
      }
      if (!declNode) continue;
      const declKey = `${declNode.from}:${declNode.to}`;
      let entry = declTransforms.get(declKey);
      if (!entry) {
        entry = {
          declNode,
          blockScope: scope,
          scopeName: scope.name,
          bindings: new Set(),
          allScopedNames: scopedNames,
        };
        declTransforms.set(declKey, entry);
      }
      entry.bindings.add(bindingName);
    }

    if (forStmt && scopedNames.size > 0) {
      collectForSpecScopedRefEdits(builder, forStmt, scope, scopedNames, edits);
    }

    if (scopedNames.size > 0) {
      collectBlockScopedRefEdits(builder, scope.blockNode, scope, scopedNames, edits);
    }
  }

  for (const { declNode, blockScope, scopeName, bindings, allScopedNames } of declTransforms.values()) {
    if (!declUsesWholesaleTransform(declNode, builder.source, bindings)) {
      collectInPlaceDeclarationEdits(builder, declNode, scopeName, bindings, edits);
      continue;
    }
    const transformed = transformBindingDeclaration(
      builder,
      declNode,
      blockScope,
      scopeName,
      bindings,
      allScopedNames,
      freeVarUses,
    );
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
      const member = `${use.scope.name}.${use.name}`;
      edits.push({
        kind: 'replace',
        from: use.from,
        to: use.to,
        text: isReferenceUsedAsCallCallee(builder.source, use.from, use.to) ? `(${member})` : member,
      });
    }
  }
}

function capturedScopedNamesForFunction(
  funcFrom: number,
  funcTo: number,
  scopes: LexicalScope[],
  freeVarUses: FreeVarUse[],
): Map<string, string> {
  const captured = new Map<string, string>();
  for (const use of freeVarUses) {
    if (use.world) continue;
    if (use.funcNode.from !== funcFrom || use.funcNode.to !== funcTo) continue;
    if (!use.scope.needsObject()) continue;
    if (!scopes.some((scope) => scope.id === use.scope.id)) continue;
    captured.set(use.name, use.scope.name);
  }
  return captured;
}

function rewriteClosureScopedNamesInCode(codeInner: string, captured: Map<string, string>): string {
  if (captured.size === 0) return codeInner;
  const edits: { from: number; to: number; text: string }[] = [];
  const tree = parser.parse(codeInner);
  rewriteClosureScopedRefsInNode(tree.topNode, codeInner, captured, edits);
  if (edits.length === 0) return codeInner;
  edits.sort((a, b) => b.from - a.from);
  let text = codeInner;
  for (const edit of edits) {
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  }
  return text;
}

function rewriteClosureScopedRefsInNode(
  node: SyntaxNode,
  source: string,
  captured: Map<string, string>,
  edits: { from: number; to: number; text: string }[],
): void {
  if (FUNCTION_NODES.has(node.name) || node.name === 'FunctionDeclaration') return;

  if (node.name === 'VariableDeclaration') {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== 'Equals') continue;
      for (let init = child.nextSibling; init; init = init.nextSibling) {
        if (init.name === ';' || init.name === ',') break;
        rewriteClosureScopedRefsInNode(init, source, captured, edits);
      }
    }
    return;
  }

  if (node.name === 'Block') {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === '{' || child.name === '}') continue;
      rewriteClosureScopedRefsInNode(child, source, captured, edits);
    }
    return;
  }

  if (node.name === 'ForStatement') {
    const spec = node.getChild('ForSpec') ?? node.getChild('ForInSpec') ?? node.getChild('ForOfSpec');
    if (spec) {
      forEachForSpecExpression(spec, (expr) => rewriteClosureScopedRefsInNode(expr, source, captured, edits));
    }
    const loopBlock = node.getChild('Block');
    if (loopBlock) {
      for (let child = loopBlock.firstChild; child; child = child.nextSibling) {
        if (child.name === '{' || child.name === '}') continue;
        rewriteClosureScopedRefsInNode(child, source, captured, edits);
      }
    }
    return;
  }

  if (node.name === 'AssignmentExpression') {
    const lhs = node.firstChild;
    if (lhs?.name === 'VariableName') {
      const name = nodeText(lhs, source);
      const scopeName = captured.get(name);
      if (scopeName) {
        edits.push({
          from: lhs.from,
          to: lhs.to,
          text: scopedMemberRef(source, lhs.from, lhs.to, name, scopeName),
        });
      }
    } else if (lhs) {
      rewriteClosureScopedRefsInNode(lhs, source, captured, edits);
    }
    const rhs = node.lastChild;
    if (rhs && rhs !== lhs) rewriteClosureScopedRefsInNode(rhs, source, captured, edits);
    return;
  }

  if (node.name === 'UpdateExpression') {
    const varName = node.getChild('VariableName');
    if (varName) {
      const name = nodeText(varName, source);
      const scopeName = captured.get(name);
      if (scopeName) {
        edits.push({
          from: varName.from,
          to: varName.to,
          text: scopedMemberRef(source, varName.from, varName.to, name, scopeName),
        });
      }
    }
    return;
  }

  if (node.name === 'VariableName') {
    const name = nodeText(node, source);
    const scopeName = captured.get(name);
    if (scopeName) {
      edits.push({
        from: node.from,
        to: node.to,
        text: scopedMemberRef(source, node.from, node.to, name, scopeName),
      });
    }
    return;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    rewriteClosureScopedRefsInNode(child, source, captured, edits);
  }
}

function collectFunctionEdits(
  builder: ScopeBuilder,
  functions: FunctionTarget[],
  freeVarUses: FreeVarUse[],
  edits: Edit[],
): void {
  for (const target of functions) {
    const scopes = scopesForFunction(freeVarUses, target.node, functions);
    if (target.kind === 'decl') {
      edits.push({
        kind: 'funcDecl',
        from: target.node.from,
        to: target.node.to,
        name: target.declName!,
        scopes,
        scopeAssignment: scopeNameForScopedFunctionDecl(builder, target.node, target.declName!, freeVarUses) ?? undefined,
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
  scopeAssignment?: string,
): string {
  const params = renderScopeList(scopes);
  const codeFuncArg = scopes.length > 0 ? `(${params}) => ${codeInner}` : `() => ${codeInner}`;
  const showArg = JSON.stringify(showInner);
  const codeArg = JSON.stringify(codeFuncArg);
  const scopeArg = scopes.length > 0 ? `, [${params}]` : '';
  const call = `$fun(${showArg}, ${codeArg}${scopeArg})`;
  if (declName !== undefined) {
    if (scopeAssignment) return `${scopeAssignment}.${declName} = ${call};`;
    return `const ${declName} = ${call};`;
  }
  return call;
}

function renderEdit(
  source: string,
  start: number,
  end: number,
  edit: Edit,
  originalSource: string,
  freeVarUses: FreeVarUse[],
): string {
  if (edit.kind === 'replace') return edit.text;
  if (edit.kind === 'arr') return `$arr(${source.slice(start, end)})`;
  if (edit.kind === 'obj') return `$obj(${source.slice(start, end)})`;
  if (edit.kind === 'insert') return edit.text;

  let codeInner = source.slice(start, end);
  const showInner = originalSource.slice(edit.from, edit.to);
  codeInner = rewriteClosureScopedNamesInCode(
    codeInner,
    capturedScopedNamesForFunction(edit.from, edit.to, edit.scopes, freeVarUses),
  );
  if (edit.kind === 'funcDecl') {
    return renderFuncCall(
      showInner,
      functionExpressionSource(codeInner),
      edit.scopes,
      edit.name,
      edit.scopeAssignment,
    );
  }
  return renderFuncCall(showInner, codeInner, edit.scopes);
}

function applyEdits(source: string, edits: Edit[], freeVarUses: FreeVarUse[]): string {
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
    const text = renderEdit(out, start, end, edit, source, freeVarUses);
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
  supplementScopedFunctionUses(builder, functions, freeVarUses);

  const edits: Edit[] = [];
  collectLiteralEdits(tree.topNode, source, edits, []);
  collectScopeEdits(builder, freeVarUses, edits);
  collectWorldRefEdits(builder, rootScope, tree.topNode, freeVarUses, edits);
  collectFunctionEdits(builder, functions, freeVarUses, edits);
  const result = applyEdits(source, edits, freeVarUses);
  return parenthesizeNewGlobalTargets(transformTopLevelDeclarations(result));
}

export function transpile(source: string): string {
  return transpileCore(expandClasses(source));
}
