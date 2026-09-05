import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as ts from 'typescript';

const REPO_ROOT = resolve(__dirname, '..', '..');

function repoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

type WorkflowStepValue = {
  readonly value: string;
  readonly line: number;
};

function workflowStepValues(workflow: string, key: 'run' | 'uses'): WorkflowStepValue[] {
  const lines = workflow.split(/\r?\n/);
  const values: WorkflowStepValue[] = [];
  const pattern = new RegExp(`^(\\s*)${key}:\\s*(.*?)\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) {
      continue;
    }
    const indentation = match[1].length;
    const scalar = match[2].replace(/\s+#.*$/, '').trim();
    if (scalar !== '|' && scalar !== '>') {
      values.push({ value: scalar, line: index + 1 });
      continue;
    }
    const block: string[] = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) {
        continue;
      }
      const nextIndentation = line.match(/^\s*/)?.[0].length ?? 0;
      if (nextIndentation <= indentation) {
        break;
      }
      if (!line.trimStart().startsWith('#')) {
        block.push(line.trim());
      }
    }
    values.push({ value: block.join('\n'), line: index + 1 });
    index = cursor - 1;
  }
  return values;
}

function assertExactVscePin(commands: readonly WorkflowStepValue[]): void {
  const tokens = commands.flatMap(({ value }) =>
    value.match(/@vscode\/vsce(?:@[^\s]+)?/g) ?? [],
  );
  assert.ok(tokens.length > 0, 'workflow must invoke VSCE');
  for (const token of tokens) {
    assert.equal(token, '@vscode/vsce@3.9.1', `unexpected VSCE invocation ${token}`);
  }
}

function activePatterns(relativePath: string): Set<string> {
  return new Set(
    repoFile(relativePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

type AstProject = {
  readonly files: ts.SourceFile[];
  readonly declarations: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>;
};

const BANNED_PERSISTED_PROPERTIES = /(?:^|_)(?:carry|raw(?:_?line|_?input|_?fragment)|incomplete(?:_?line|_?input))(?:$|_)/i;
const LEGACY_STRUCTURAL_PROPERTIES = new Set([
  'filesChanged',
  'patchRounds',
  'commands',
  'postChangeCommands',
]);

function projectFromSources(sources: Readonly<Record<string, string>>): AstProject {
  const files = Object.entries(sources).map(([name, text]) =>
    ts.createSourceFile(name, text, ts.ScriptTarget.ES2020, true),
  );
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  for (const file of files) {
    for (const statement of file.statements) {
      if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name) {
        declarations.set(statement.name.text, statement);
      }
    }
  }
  return { files, declarations };
}

function propertyName(name: ts.PropertyName | ts.MemberName | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function referencedTypeName(type: ts.TypeNode): string | undefined {
  if (!ts.isTypeReferenceNode(type)) {
    return undefined;
  }
  return ts.isIdentifier(type.typeName) ? type.typeName.text : undefined;
}

function persistedPropertyViolations(project: AstProject, rootName: string): string[] {
  const violations: string[] = [];
  const visited = new Set<string>();
  const inspectType = (type: ts.TypeNode | undefined, path: string): void => {
    if (!type) {
      return;
    }
    if (ts.isTypeReferenceNode(type)) {
      for (const argument of type.typeArguments ?? []) {
        inspectType(argument, path);
      }
      const name = referencedTypeName(type);
      if (name && project.declarations.has(name) && !visited.has(name)) {
        inspectDeclaration(project.declarations.get(name)!, `${path}.${name}`);
      }
      return;
    }
    if (ts.isArrayTypeNode(type)) {
      inspectType(type.elementType, path);
    } else if (ts.isTupleTypeNode(type)) {
      for (const element of type.elements) {
        inspectType(ts.isNamedTupleMember(element) ? element.type : element, path);
      }
    } else if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      for (const item of type.types) {
        inspectType(item, path);
      }
    } else if (ts.isParenthesizedTypeNode(type)) {
      inspectType(type.type, path);
    } else if (ts.isTypeLiteralNode(type)) {
      inspectMembers(type.members, path);
    }
  };
  const inspectMembers = (members: ts.NodeArray<ts.TypeElement>, path: string): void => {
    for (const member of members) {
      if (ts.isPropertySignature(member)) {
        const name = propertyName(member.name);
        if (name && BANNED_PERSISTED_PROPERTIES.test(name)) {
          violations.push(`${path}.${name}`);
        }
        inspectType(member.type, name ? `${path}.${name}` : path);
      } else if (ts.isIndexSignatureDeclaration(member)) {
        inspectType(member.type, path);
      }
    }
  };
  const inspectDeclaration = (
    declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
    path: string,
  ): void => {
    const name = declaration.name.text;
    if (visited.has(name)) {
      return;
    }
    visited.add(name);
    if (ts.isInterfaceDeclaration(declaration)) {
      inspectMembers(declaration.members, path);
    } else {
      inspectType(declaration.type, path);
    }
  };
  const root = project.declarations.get(rootName);
  if (!root) {
    return [`missing root ${rootName}`];
  }
  inspectDeclaration(root, rootName);
  return violations;
}

function functionDeclarations(file: ts.SourceFile): ReadonlyMap<string, ts.FunctionLikeDeclaration> {
  const declarations = new Map<string, ts.FunctionLikeDeclaration>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      declarations.set(node.name.text, node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return declarations;
}

function sanitizedDtoViolations(file: ts.SourceFile): string[] {
  const declarations = functionDeclarations(file);
  const trustedLabelSanitizerBindings = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== './codexMetadataLabel' ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const specifier of statement.importClause.namedBindings.elements) {
      const exportedName = specifier.propertyName?.text ?? specifier.name.text;
      if (!specifier.isTypeOnly && exportedName === 'sanitizeCodexMetadataLabel') {
        trustedLabelSanitizerBindings.add(specifier.name.text);
      }
    }
  }
  const violations: string[] = [];
  const visited = new Set<string>();
  const fail = (message: string): void => {
    if (!violations.includes(message)) {
      violations.push(message);
    }
  };
  const expressionName = (expression: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expression)) {
      return expression.text;
    }
    return undefined;
  };
  const bindingNames = (binding: ts.BindingName): string[] => {
    if (ts.isIdentifier(binding)) {
      return [binding.text];
    }
    return binding.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingNames(element.name) : [],
    );
  };
  const isExplicitSafeExternal = (
    call: ts.CallExpression,
    shadowedBindings: ReadonlySet<string>,
  ): boolean => {
    if (ts.isIdentifier(call.expression)) {
      return call.expression.text === 'resolveTimeZone' ||
        call.expression.text === 'dayKeyInZone' ||
        (trustedLabelSanitizerBindings.has(call.expression.text) &&
          !shadowedBindings.has(call.expression.text));
    }
    if (!ts.isPropertyAccessExpression(call.expression)) {
      return false;
    }
    const receiver = call.expression.expression.getText(file);
    const member = call.expression.name.text;
    return receiver === 'Math' ||
      (receiver === 'Number' && member === 'isFinite') ||
      (receiver === 'Date' && member === 'now') ||
      (receiver === 'Object' && member === 'fromEntries') ||
      (ts.isRegularExpressionLiteral(call.expression.expression) && member === 'test');
  };
  const inspectFunction = (name: string, taintedParameters = new Set<string>()): void => {
    const visitKey = `${name}:${[...taintedParameters].sort().join(',')}`;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);
    const declaration = declarations.get(name);
    if (!declaration?.body) {
      fail(`missing persisted helper ${name}`);
      return;
    }
    const localInitializers = new Map<string, ts.Expression>();
    const safeCollectionParameters = new Set<string>();
    const callbackParameters = new Set<string>();
    const parameters = new Set(
      declaration.parameters.map((parameter) =>
        ts.isIdentifier(parameter.name) ? parameter.name.text : '',
      ).filter(Boolean),
    );
    const collectLocals = (node: ts.Node): void => {
      if (node !== declaration && ts.isFunctionLike(node)) {
        return;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        localInitializers.set(node.name.text, node.initializer);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        (node.expression.text === 'isRecord' || node.expression.text === 'Array.isArray') &&
        ts.isIdentifier(node.arguments[0])) {
        safeCollectionParameters.add(node.arguments[0].text);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(file) === 'Array' &&
        node.expression.name.text === 'isArray' && ts.isIdentifier(node.arguments[0])) {
        safeCollectionParameters.add(node.arguments[0].text);
      }
      ts.forEachChild(node, collectLocals);
    };
    collectLocals(declaration.body);
    const resolvingLocals = new Set<string>();
    const resolvingTaint = new Set<string>();
    const unwrap = (expression: ts.Expression): ts.Expression =>
      ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
        ? unwrap(expression.expression)
        : expression;
    const isWholesaleTainted = (expression: ts.Expression): boolean => {
      const value = unwrap(expression);
      if (ts.isIdentifier(value)) {
        if (taintedParameters.has(value.text)) {
          return true;
        }
        if (localInitializers.has(value.text) && !resolvingTaint.has(value.text)) {
          resolvingTaint.add(value.text);
          const tainted = isWholesaleTainted(localInitializers.get(value.text)!);
          resolvingTaint.delete(value.text);
          return tainted;
        }
      }
      return false;
    };
    const taintedCallParameters = (localName: string, arguments_: ts.NodeArray<ts.Expression>): Set<string> => {
      const target = declarations.get(localName);
      const tainted = new Set<string>();
      if (!target) {
        return tainted;
      }
      target.parameters.forEach((parameter, index) => {
        const actual = parameter.dotDotDotToken
          ? arguments_.slice(index).some((argument) => isWholesaleTainted(argument))
          : arguments_[index] && isWholesaleTainted(arguments_[index]);
        if (actual) {
          bindingNames(parameter.name).forEach((binding) => tainted.add(binding));
        }
      });
      return tainted;
    };
    const inspectCallback = (callback: ts.Expression): void => {
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
        fail(`${name} uses a non-local collection callback`);
        return;
      }
      const scopedParameters = callback.parameters.flatMap((parameter) => bindingNames(parameter.name));
      scopedParameters.forEach((parameter) => callbackParameters.add(parameter));
      const previousInitializers = new Map<string, ts.Expression | undefined>();
      const collectCallbackLocals = (node: ts.Node): void => {
        if (node !== callback && ts.isFunctionLike(node)) {
          return;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          if (!previousInitializers.has(node.name.text)) {
            previousInitializers.set(node.name.text, localInitializers.get(node.name.text));
          }
          localInitializers.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, collectCallbackLocals);
      };
      if (ts.isBlock(callback.body)) {
        collectCallbackLocals(callback.body);
      }
      if (ts.isBlock(callback.body)) {
        const inspectCallbackReturns = (node: ts.Node): void => {
          if (node !== callback && ts.isFunctionLike(node)) {
            return;
          }
          if (ts.isReturnStatement(node) && node.expression) {
            inspectExpression(node.expression, false, true);
          }
          ts.forEachChild(node, inspectCallbackReturns);
        };
        inspectCallbackReturns(callback.body);
      } else {
        inspectExpression(callback.body, false, true);
      }
      scopedParameters.forEach((parameter) => callbackParameters.delete(parameter));
      previousInitializers.forEach((initializer, local) => {
        if (initializer) {
          localInitializers.set(local, initializer);
        } else {
          localInitializers.delete(local);
        }
      });
    };
    const inspectSafeSource = (expression: ts.Expression, viaProperty = false): void => {
      const value = unwrap(expression);
      if (ts.isPropertyAccessExpression(value)) {
        if (BANNED_PERSISTED_PROPERTIES.test(value.name.text)) {
          fail(`${name} reads banned persisted property ${value.name.text}`);
          return;
        }
        inspectSafeSource(value.expression, true);
      } else if (ts.isElementAccessExpression(value) && ts.isStringLiteral(value.argumentExpression)) {
        if (BANNED_PERSISTED_PROPERTIES.test(value.argumentExpression.text)) {
          fail(`${name} reads banned persisted property ${value.argumentExpression.text}`);
          return;
        }
        inspectSafeSource(value.expression, true);
      } else if (ts.isIdentifier(value)) {
        if (localInitializers.has(value.text) && !resolvingLocals.has(value.text)) {
          resolvingLocals.add(value.text);
          inspectCollection(localInitializers.get(value.text)!, viaProperty);
          resolvingLocals.delete(value.text);
        } else if (taintedParameters.has(value.text) && !viaProperty) {
          fail(`${name} uses tainted parameter ${value.text} as a constructed source`);
        } else if (!parameters.has(value.text) || (!viaProperty && !safeCollectionParameters.has(value.text))) {
          fail(`${name} uses an opaque constructed source ${value.text}`);
        }
      } else {
        fail(`${name} uses an opaque constructed source`);
      }
    };
    const inspectCollection = (expression: ts.Expression, fromExplicitProperty = false): void => {
      const value = unwrap(expression);
      if (ts.isArrayLiteralExpression(value)) {
        value.elements.forEach((element) => {
          if (ts.isExpression(element)) {
            inspectExpression(element, false, true);
          }
        });
      } else if (ts.isObjectLiteralExpression(value)) {
        inspectExpression(value);
      } else if (ts.isConditionalExpression(value)) {
        inspectCollection(value.whenTrue, fromExplicitProperty);
        inspectCollection(value.whenFalse, fromExplicitProperty);
      } else if (ts.isBinaryExpression(value) && (
        value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )) {
        inspectCollection(value.left, fromExplicitProperty);
        inspectCollection(value.right, fromExplicitProperty);
      } else if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
        const receiver = value.expression.expression;
        const member = value.expression.name.text;
        if (receiver.getText(file) === 'Object' && (member === 'entries' || member === 'values')) {
          if (value.arguments[0]) {
            inspectSafeSource(value.arguments[0]);
          } else {
            fail(`${name} uses an opaque constructed source`);
          }
        } else if (member === 'map' || member === 'flatMap' || member === 'filter') {
          inspectCollection(receiver);
          for (const argument of value.arguments) {
            inspectCallback(argument);
          }
        } else {
          fail(`${name} uses an opaque collection receiver`);
        }
      } else if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) ||
        ts.isElementAccessExpression(value)) {
        inspectSafeSource(value, fromExplicitProperty);
      } else {
        fail(`${name} uses an opaque constructed source`);
      }
    };
    const inspectExpression = (
      expression: ts.Expression,
      inSpread = false,
      entryTuple = false,
      asSanitizerArgument = false,
    ): void => {
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
        ts.isTypeAssertionExpression(expression)) {
        inspectExpression(expression.expression, inSpread, entryTuple, asSanitizerArgument);
      } else if (ts.isConditionalExpression(expression)) {
        inspectExpression(expression.whenTrue, inSpread, entryTuple, asSanitizerArgument);
        inspectExpression(expression.whenFalse, inSpread, entryTuple, asSanitizerArgument);
      } else if (ts.isBinaryExpression(expression) && (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )) {
        inspectExpression(expression.left, inSpread, entryTuple, asSanitizerArgument);
        inspectExpression(expression.right, inSpread, entryTuple, asSanitizerArgument);
      } else if (ts.isArrayLiteralExpression(expression)) {
        expression.elements.forEach((element, index) => {
          if (ts.isSpreadElement(element)) {
            inspectExpression(element.expression, true, entryTuple, asSanitizerArgument);
          } else if (ts.isExpression(element)) {
            if (entryTuple && index === 0 && ts.isIdentifier(element) &&
              callbackParameters.has(element.text)) {
              return;
            }
            inspectExpression(element, false, entryTuple || index === 0, asSanitizerArgument);
          }
        });
      } else if (ts.isObjectLiteralExpression(expression)) {
        for (const property of expression.properties) {
          if (ts.isSpreadAssignment(property)) {
            inspectExpression(property.expression, true, entryTuple, asSanitizerArgument);
          } else if (ts.isPropertyAssignment(property)) {
            const propertyKey = propertyName(property.name);
            if (propertyKey && BANNED_PERSISTED_PROPERTIES.test(propertyKey)) {
              fail(`${name} persists banned property ${propertyKey}`);
            }
            inspectExpression(property.initializer, false, entryTuple, asSanitizerArgument);
          } else if (ts.isShorthandPropertyAssignment(property)) {
            const propertyKey = property.name.text;
            if (BANNED_PERSISTED_PROPERTIES.test(propertyKey)) {
              fail(`${name} persists banned property ${propertyKey}`);
            }
            inspectExpression(property.name, false, entryTuple, asSanitizerArgument);
          }
        }
      } else if (ts.isCallExpression(expression)) {
        const localName = expressionName(expression.expression);
        if (localName && declarations.has(localName)) {
          inspectFunction(localName, taintedCallParameters(localName, expression.arguments));
        } else if (ts.isPropertyAccessExpression(expression.expression) &&
          ['map', 'flatMap', 'filter'].includes(expression.expression.name.text)) {
          inspectCollection(expression);
        } else if (ts.isPropertyAccessExpression(expression.expression) &&
          expression.expression.expression.getText(file) === 'Object' &&
          expression.expression.name.text === 'fromEntries') {
          if (expression.arguments[0]) {
            inspectCollection(expression.arguments[0]);
          } else {
            fail(`${name} uses an opaque constructed source`);
          }
        } else if (ts.isPropertyAccessExpression(expression.expression) &&
          expression.expression.name.text === 'sort') {
          inspectCollection(expression.expression.expression);
          expression.arguments.forEach((argument) => inspectExpression(argument, false, false, true));
        } else if (!isExplicitSafeExternal(
          expression,
          new Set([...parameters, ...localInitializers.keys(), ...callbackParameters]),
        )) {
          fail(inSpread
            ? `${name} spreads opaque external output`
            : `${name} persists opaque external output`);
        } else {
          if (ts.isPropertyAccessExpression(expression.expression) &&
            !['Math', 'Number', 'Date', 'Object'].includes(
              expression.expression.expression.getText(file),
            )) {
            inspectExpression(expression.expression.expression, false, false, true);
          }
          expression.arguments.forEach((argument) => inspectExpression(argument, false, false, true));
        }
      } else if (ts.isNewExpression(expression)) {
        if (ts.isIdentifier(expression.expression) && expression.expression.text === 'Set') {
          if (expression.arguments?.[0]) {
            inspectCollection(expression.arguments[0]);
          }
          expression.arguments?.slice(1).forEach((argument) => inspectExpression(argument, false, false, true));
        } else if (ts.isIdentifier(expression.expression) && expression.expression.text === 'Date') {
          expression.arguments?.forEach((argument) => inspectExpression(argument, false, false, true));
        } else {
          fail(`${name} persists opaque constructed output`);
        }
      } else if (ts.isIdentifier(expression)) {
        if (taintedParameters.has(expression.text) && !asSanitizerArgument) {
          fail(`${name} persists tainted parameter ${expression.text}`);
        } else if (localInitializers.has(expression.text) && !resolvingLocals.has(expression.text)) {
          resolvingLocals.add(expression.text);
          inspectExpression(
            localInitializers.get(expression.text)!,
            inSpread,
            entryTuple,
            asSanitizerArgument,
          );
          resolvingLocals.delete(expression.text);
        } else if (inSpread) {
          fail(`${name} spreads arbitrary persisted input`);
        }
      } else if (ts.isPropertyAccessExpression(expression)) {
        if (BANNED_PERSISTED_PROPERTIES.test(expression.name.text)) {
          fail(`${name} reads banned persisted property ${expression.name.text}`);
        }
      } else if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
        if (BANNED_PERSISTED_PROPERTIES.test(expression.argumentExpression.text)) {
          fail(`${name} reads banned persisted property ${expression.argumentExpression.text}`);
        }
      } else if (inSpread) {
        fail(`${name} spreads arbitrary persisted input`);
      }
    };
    const inspectReturns = (node: ts.Node): void => {
      if (node !== declaration && (ts.isFunctionLike(node) || ts.isClassLike(node))) {
        return;
      }
      if (ts.isReturnStatement(node) && node.expression) {
        inspectExpression(node.expression);
      }
      ts.forEachChild(node, inspectReturns);
    };
    if (ts.isBlock(declaration.body)) {
      inspectReturns(declaration.body);
    } else {
      inspectExpression(declaration.body);
    }
  };
  const rootParameters = declarations.get('sanitizeIndexV2')?.parameters.flatMap(
    (parameter) => bindingNames(parameter.name),
  ) ?? [];
  inspectFunction('sanitizeIndexV2', new Set(rootParameters));
  const root = declarations.get('sanitizeIndexV2');
  const returned = root?.body && ts.isBlock(root.body)
    ? root.body.statements.find(ts.isReturnStatement)?.expression
    : undefined;
  if (!returned || !ts.isObjectLiteralExpression(returned)) {
    violations.push('sanitizeIndexV2 must return an explicit object literal');
  } else {
    const branches = returned.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
        ? [propertyName(property.name)]
        : [],
    );
    const expected = ['schemaVersion', 'files', 'aggregate', 'coverage'];
    if (branches.length !== expected.length || expected.some((branch) => !branches.includes(branch))) {
      violations.push('sanitizeIndexV2 top-level branches are not exact');
    }
  }
  const atomic = declarations.get('saveCodexIndexAtomic');
  let writesSanitizedDto = false;
  const scanAtomic = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'writeFile') {
      const value = node.arguments[0];
      if (value && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
        value.expression.expression.getText(file) === 'JSON' && value.expression.name.text === 'stringify') {
        const serialized = value.arguments[0];
        writesSanitizedDto = Boolean(serialized && ts.isCallExpression(serialized) &&
          ts.isIdentifier(serialized.expression) && serialized.expression.text === 'sanitizeIndexV2' &&
          serialized.arguments[0]?.getText(file) === 'index');
      }
    }
    ts.forEachChild(node, scanAtomic);
  };
  if (atomic?.body) {
    ts.forEachChild(atomic.body, scanAtomic);
  }
  if (!writesSanitizedDto) {
    violations.push('atomic save does not stringify sanitizeIndexV2(index)');
  }
  return violations;
}

function legacyBoundaryName(node: ts.Node): string | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if ((ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current) ||
      ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) && current.name) {
      return current.name.text;
    }
  }
  return undefined;
}

function legacyStructuralViolations(files: readonly ts.SourceFile[]): string[] {
  const violations: string[] = [];
  const inspect = (node: ts.Node): void => {
    let name: string | undefined;
    if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
      name = propertyName(node.name);
    } else if (ts.isPropertyAccessExpression(node)) {
      name = node.name.text;
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      name = node.argumentExpression.text;
    }
    if (name && LEGACY_STRUCTURAL_PROPERTIES.has(name)) {
      const boundary = legacyBoundaryName(node);
      if (!boundary || !(/^(Legacy|migrateLegacy)/.test(boundary))) {
        violations.push(`${node.getSourceFile().fileName}:${name}`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  for (const file of files) {
    inspect(file);
  }
  return violations;
}

function misleadingCopyViolations(files: readonly ts.SourceFile[]): string[] {
  const violations: string[] = [];
  const misleading = /(?:files? changed|patch rounds|post[- ]?change commands?|command (?:count|overhead)|commands? (?:run|executed))/i;
  const inspect = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && misleading.test(node.text)) {
      violations.push(`${node.getSourceFile().fileName}:${node.text}`);
    }
    if (ts.isPropertyAssignment(node) && LEGACY_STRUCTURAL_PROPERTIES.has(propertyName(node.name) ?? '')) {
      violations.push(`${node.getSourceFile().fileName}:${propertyName(node.name)}`);
    }
    ts.forEachChild(node, inspect);
  };
  for (const file of files) {
    inspect(file);
  }
  return violations;
}

function hardcodedCodexRenderCopyViolations(file: ts.SourceFile): string[] {
  const violations: string[] = [];
  if (!/(?:^|[\\/])codexViewComponents\.ts$/.test(file.fileName)) {
    return violations;
  }
  const forbiddenWords = /\b(?:files|bytes|primary|secondary|commands per file|tax|overhead)\b/i;
  const compactUnit = /\{\{value\}\}\s*(?:m|h|d)\b/i;
  const rendererName = /^(?:render)|(?:Card|Table|Chart|Panel|Bar|Marker|Label|Section|Composition|Constraint|Summary)$/;
  const declarationName = (declaration: ts.FunctionLikeDeclaration): string | undefined => {
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) ||
      ts.isFunctionExpression(declaration)) {
      const named = propertyName(declaration.name);
      if (named) {
        return named;
      }
    }
    const parent = declaration.parent;
    return parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
      ? parent.name.text
      : undefined;
  };
  const rawTemplate = (node: ts.TemplateExpression): string =>
    node.head.text + node.templateSpans
      .map((span) => `{{value}}${span.literal.text}`)
      .join('');
  const hasVisibleViolation = (raw: string, markup: boolean): boolean => {
    if (compactUnit.test(raw)) {
      return true;
    }
    if (!markup) {
      return forbiddenWords.test(raw);
    }
    const attributes = [...raw.matchAll(/\b(?:aria-label|title)\s*=\s*(["'])(.*?)\1/gis)]
      .map((match) => match[2]);
    const visible = raw.replace(/<[^>]*>/gs, ' ');
    return forbiddenWords.test(visible) || attributes.some((value) => forbiddenWords.test(value));
  };
  const inspectFunction = (declaration: ts.FunctionLikeDeclaration): void => {
    if (!declaration.body) {
      return;
    }
    const visit = (node: ts.Node): void => {
      let raw: string | undefined;
      if (ts.isTemplateExpression(node)) {
        raw = rawTemplate(node);
      } else if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
        raw = node.text;
      }
      if (raw !== undefined) {
        if (hasVisibleViolation(raw, raw.includes('<'))) {
          violations.push(`${file.fileName}:${raw.replace(/\s+/g, ' ').trim()}`);
        }
        if (ts.isTemplateExpression(node)) {
          for (const span of node.templateSpans) {
            visit(span.expression);
          }
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration.body);
  };
  const inspected = new Set<ts.FunctionLikeDeclaration>();
  const findRenderers = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const name = declarationName(node);
      if (name && rendererName.test(name) && !inspected.has(node)) {
        inspected.add(node);
        inspectFunction(node);
      }
    }
    ts.forEachChild(node, findRenderers);
  };
  findRenderers(file);
  return violations;
}

function callOptionKeys(
  file: ts.SourceFile,
  methodName: string,
  calleeName: string,
  argumentIndex: number,
): string[] {
  let method: ts.MethodDeclaration | undefined;
  const findMethod = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && propertyName(node.name) === methodName) {
      method = node;
      return;
    }
    ts.forEachChild(node, findMethod);
  };
  findMethod(file);
  if (!method?.body) {
    return [];
  }
  const keys = new Set<string>();
  const inspect = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === calleeName) {
      const options = node.arguments[argumentIndex];
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) ||
            ts.isMethodDeclaration(property)) {
            const name = propertyName(property.name);
            if (name) {
              keys.add(name);
            }
          }
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(method.body);
  return [...keys].sort();
}

function projectSourceFiles(prefix: string): Record<string, string> {
  const paths = execFileSync('git', ['ls-files', prefix], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim().split('\n').filter((path) =>
    path.endsWith('.ts') && existsSync(resolve(REPO_ROOT, path))
  );
  return Object.fromEntries(paths.map((path) => [path, repoFile(path)]));
}

test('AGENTS is the canonical Codex repository policy', () => {
  const agents = repoFile('AGENTS.md');
  assert.match(agents, /Codex Beta in v2\.3\.0/);
  assert.match(agents, /2\.4-GB-class history.*worker/is);
  assert.match(agents, /no new runtime dependencies/i);
  assert.match(agents, /all eight UI locales/i);
  assert.match(agents, /push, open a pull request, merge, or publish a release/i);
  assert.match(agents, /Generated with \[OpenAI Codex\]/);
  assert.match(agents, /Co-authored-by: OpenAI Codex <215057067\+openai-codex\[bot\]@users\.noreply\.github\.com>/);
});

test('AGENTS links a faithful Simplified-Chinese review copy', () => {
  const agents = repoFile('AGENTS.md');
  const chinese = repoFile('AGENTS.zh-CN.md');
  assert.match(agents, /AGENTS\.zh-CN\.md/);
  assert.match(chinese, /v2\.3\.0.*Codex Beta/);
  assert.match(chinese, /主要撰写.*OpenAI Codex.*Co-authored-by/is);
  assert.match(chinese, /中文链接排在英文链接之前/);
  assert.match(chinese, /推送、创建 PR、合并或发布 Release/);
});

test('AGENTS allow only the guarded Codex session-index title lookup', () => {
  const agents = repoFile('AGENTS.md');
  const chinese = repoFile('AGENTS.zh-CN.md');

  for (const pattern of [
    /\$CODEX_HOME\/session_index\.jsonl[\s\S]*solely[\s\S]*`id`[\s\S]*`thread_name`/i,
    /absolute paths[\s\S]*masked/i,
    /titles[\s\S]*stay in memory[\s\S]*never persisted/i,
    /symlinks[\s\S]*non-regular files[\s\S]*rejected/i,
    /no other field[\s\S]*read/i,
  ]) {
    assert.match(agents, pattern);
  }
  for (const pattern of [
    /\$CODEX_HOME\/session_index\.jsonl[\s\S]*仅[\s\S]*`id`[\s\S]*`thread_name`/,
    /标题中的绝对路径[\s\S]*遮蔽/,
    /标题[\s\S]*仅驻留内存[\s\S]*绝不持久化/,
    /符号链接[\s\S]*非普通文件[\s\S]*拒绝/,
    /不读取[\s\S]*其他字段/,
  ]) {
    assert.match(chinese, pattern);
  }
});

test('contributor pull requests retain their merged attribution', () => {
  const agents = repoFile('AGENTS.md');
  const chinese = repoFile('AGENTS.zh-CN.md');
  assert.match(agents, /Never copy.*contributor pull request.*close.*superseded/is);
  assert.match(agents, /merge the\s+contributor's original pull request/i);
  assert.match(agents, /needs revision.*original PR branch.*then merge/is);
  assert.match(agents, /Close.*without merging.*only.*no\s+meaningful contribution.*empty.*spam.*irrelevant/is);
  assert.match(chinese, /严禁.*贡献者 PR.*吸收.*关闭/is);
  assert.match(chinese, /合并贡献者的原始 PR/);
  assert.match(chinese, /不够合理.*原 PR 分支.*修改后合并/is);
  assert.match(chinese, /不合并而关闭.*无可保留价值.*空 PR.*spam.*无关/is);
});

test('CLAUDE is a compatibility entry point, not a conflicting policy source', () => {
  const claude = repoFile('CLAUDE.md');
  assert.match(claude, /AGENTS\.md.*canonical repository policy/);
  assert.match(claude, /polling always follows\s+`refreshInterval`/);
  assert.doesNotMatch(claude, /activity-aware: ~15 s|never writes to `~\/\.claude\/`/);
});

test('line endings and tracked file modes are repository-safe', () => {
  const attributes = repoFile('.gitattributes');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  for (const binary of ['*.png binary', '*.jpg binary', '*.jpeg binary', '*.gif binary', '*.webp binary', '*.ico binary', '*.vsix binary']) {
    assert.match(attributes, new RegExp(`^${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }

  const badModes = execFileSync('git', ['ls-files', '--stage'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith('100644 '));
  assert.deepEqual(badModes, []);
});

test('semantic Codex policy validators reject nested DTO leaks, comment-only sanitizers, and misleading legacy fixtures', () => {
  const nestedLeak = projectFromSources({
    'fixture.ts': [
      'interface CodexIndexV3 { files: Record<string, CodexFileContribution>; }',
      'interface CodexFileContribution { migration: CodexPeriodMigrationState; }',
      'interface CodexPeriodMigrationState { days: Record<string, CodexDailySlice>; }',
      'interface CodexDailySlice { rawLine: string; carry: string; }',
    ].join('\n'),
  });
  assert.deepEqual(
    persistedPropertyViolations(nestedLeak, 'CodexIndexV3'),
    [
      'CodexIndexV3.files.CodexFileContribution.migration.CodexPeriodMigrationState.days.CodexDailySlice.rawLine',
      'CodexIndexV3.files.CodexFileContribution.migration.CodexPeriodMigrationState.days.CodexDailySlice.carry',
    ],
  );

  const commentOnly = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(index: unknown) { return { schemaVersion: 2, files: {}, aggregate: {}, coverage: {} }; }',
    'async function saveCodexIndexAtomic(index: unknown) {',
    '  // JSON.stringify(sanitizeIndexV2(index))',
    '  await handle.writeFile(JSON.stringify(index));',
    '}',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.deepEqual(
    sanitizedDtoViolations(commentOnly),
    ['atomic save does not stringify sanitizeIndexV2(index)'],
  );

  const conditionalRawLeak = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: {},',
    '    ...(input.ok ? ({ rawLine: input.rawLine }) : (input.other && { carry: input.carry })),',
    '  };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(
    sanitizedDtoViolations(conditionalRawLeak).join('\n'),
    /rawLine[\s\S]*carry|carry[\s\S]*rawLine/,
  );

  const unprefixedHelperLeak = ts.createSourceFile('fixture.ts', [
    'function buildPersistedPart(source: any) { return { carry: source.carry }; }',
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: {}, ...buildPersistedPart(input) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(unprefixedHelperLeak).join('\n'), /carry/);

  const safeConditionalSpread = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: {},',
    '    ...(input.ok ? { qualityFlags: input.qualityFlags } : {}),',
    '  };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.deepEqual(sanitizedDtoViolations(safeConditionalSpread), []);

  const opaqueExternalOutput = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: thirdPartyClone(input) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(opaqueExternalOutput).join('\n'), /opaque external output/);

  const explicitlyImportedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.deepEqual(
    sanitizedDtoViolations(explicitlyImportedLabelSanitizer),
    [],
  );

  const aliasedImportedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import { sanitizeCodexMetadataLabel as safeLabel } from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: safeLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const unboundLabelSanitizer = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const wrongModuleLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import { sanitizeCodexMetadataLabel } from './thirdParty';",
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const defaultImportedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import sanitizeCodexMetadataLabel from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const namespaceImportedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import * as labels from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: labels.sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const localLabelSanitizer = ts.createSourceFile('fixture.ts', [
    'function sanitizeCodexMetadataLabel(value: any) { return value; }',
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const parameterShadowedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any, sanitizeCodexMetadataLabel: any) {',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const functionLocalShadowedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any) {',
    '  const sanitizeCodexMetadataLabel = thirdPartyClone;',
    '  return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);

  const blockLocalShadowedLabelSanitizer = ts.createSourceFile('fixture.ts', [
    "import { sanitizeCodexMetadataLabel } from './codexMetadataLabel';",
    'function sanitizeIndexV2(input: any) {',
    '  {',
    '    const sanitizeCodexMetadataLabel = thirdPartyClone;',
    '    return { schemaVersion: 2, files: {}, aggregate: {}, coverage: sanitizeCodexMetadataLabel(input.coverage) };',
    '  }',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.deepEqual(
    {
      alias: sanitizedDtoViolations(aliasedImportedLabelSanitizer),
      unbound: sanitizedDtoViolations(unboundLabelSanitizer),
      wrongModule: sanitizedDtoViolations(wrongModuleLabelSanitizer),
      defaultImport: sanitizedDtoViolations(defaultImportedLabelSanitizer),
      namespaceImport: sanitizedDtoViolations(namespaceImportedLabelSanitizer),
      localDeclaration: sanitizedDtoViolations(localLabelSanitizer),
      parameterShadow: sanitizedDtoViolations(parameterShadowedLabelSanitizer),
      functionLocalShadow: sanitizedDtoViolations(
        functionLocalShadowedLabelSanitizer,
      ),
      blockLocalShadow: sanitizedDtoViolations(blockLocalShadowedLabelSanitizer),
    },
    {
      alias: [],
      unbound: ['sanitizeIndexV2 persists opaque external output'],
      wrongModule: ['sanitizeIndexV2 persists opaque external output'],
      defaultImport: ['sanitizeIndexV2 persists opaque external output'],
      namespaceImport: ['sanitizeIndexV2 persists opaque external output'],
      localDeclaration: [
        'sanitizeCodexMetadataLabel persists tainted parameter value',
      ],
      parameterShadow: ['sanitizeIndexV2 persists opaque external output'],
      functionLocalShadow: ['sanitizeIndexV2 persists opaque external output'],
      blockLocalShadow: [
        'sanitizeIndexV2 persists opaque external output',
        'sanitizeIndexV2 must return an explicit object literal',
      ],
    },
  );

  const constructedCarry = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(raw: any) {',
    "  return { schemaVersion: 2, files: Object.fromEntries([['x', { carry: raw }]]), aggregate: {}, coverage: {} };",
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(constructedCarry).join('\n'), /carry/);

  const constructedRaw = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(raw: any) {',
    "  return { schemaVersion: 2, files: Object.fromEntries([['x', { safe: raw }]]), aggregate: {}, coverage: {} };",
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(constructedRaw).join('\n'), /tainted parameter raw/);

  const destructuredRootRaw = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2({ raw }: any) {',
    '  return { schemaVersion: 2, files: { safe: raw }, aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(destructuredRootRaw).join('\n'), /tainted parameter raw/);

  const arrayDestructuredRootRaw = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2([raw]: any[]) {',
    '  return { schemaVersion: 2, files: { safe: raw }, aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(arrayDestructuredRootRaw).join('\n'), /tainted parameter raw/);

  const localHelperRawFlow = ts.createSourceFile('fixture.ts', [
    'function build(value: any) { return { safe: value }; }',
    'function sanitizeIndexV2(raw: any) {',
    '  return { schemaVersion: 2, files: build(raw), aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(localHelperRawFlow).join('\n'), /tainted parameter value/);

  const nestedLocalHelperRawFlow = ts.createSourceFile('fixture.ts', [
    'function build(value: any) { return { safe: value }; }',
    'function relay(value: any) { return build(value); }',
    'function sanitizeIndexV2(raw: any) {',
    '  return { schemaVersion: 2, files: relay(raw), aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(sanitizedDtoViolations(nestedLocalHelperRawFlow).join('\n'), /tainted parameter value/);

  const safeLocalHelperProperty = ts.createSourceFile('fixture.ts', [
    'function build(value: any) { return { safe: value.safe }; }',
    'function sanitizeIndexV2(raw: any) {',
    '  return { schemaVersion: 2, files: build(raw), aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.deepEqual(sanitizedDtoViolations(safeLocalHelperProperty), []);

  const opaqueMapReceiver = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: thirdParty.map(x => ({ safe: x })), aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(
    sanitizedDtoViolations(opaqueMapReceiver).join('\n'),
    /opaque (?:constructed source|receiver|external output)/,
  );

  const opaquePropertyMapReceiver = ts.createSourceFile('fixture.ts', [
    'function sanitizeIndexV2(input: any) {',
    '  return { schemaVersion: 2, files: thirdParty.files.map(x => ({ safe: x })), aggregate: {}, coverage: {} };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.match(
    sanitizedDtoViolations(opaquePropertyMapReceiver).join('\n'),
    /opaque (?:constructed source|receiver|external output)/,
  );

  const safeConstructedPipeline = ts.createSourceFile('fixture.ts', [
    'function sanitizeFile(value: any) { return { safe: value.safe }; }',
    'function sanitizeIndexV2(input: any) {',
    '  return {',
    '    schemaVersion: 2,',
    '    files: Object.fromEntries(Object.entries(input.files).map(([key, value]) => [key, sanitizeFile(value)])),',
    '    aggregate: {},',
    '    coverage: {},',
    '  };',
    '}',
    'async function saveCodexIndexAtomic(index: any) { await handle.writeFile(JSON.stringify(sanitizeIndexV2(index))); }',
  ].join('\n'), ts.ScriptTarget.ES2020, true);
  assert.deepEqual(sanitizedDtoViolations(safeConstructedPipeline), []);

  const badStructural = ts.createSourceFile(
    'codexUsage.ts',
    'function summarize(value: { patchRounds: number }) { return value.patchRounds; }',
    ts.ScriptTarget.ES2020,
    true,
  );
  const badCopy = ts.createSourceFile(
    'codexView.ts',
    "const copy = { structuralProxy: 'Post-change commands run' };",
    ts.ScriptTarget.ES2020,
    true,
  );
  assert.deepEqual(legacyStructuralViolations([badStructural]), [
    'codexUsage.ts:patchRounds',
    'codexUsage.ts:patchRounds',
  ]);
  assert.deepEqual(misleadingCopyViolations([badCopy]), [
    'codexView.ts:Post-change commands run',
  ]);

  const hardcodedRenderer = ts.createSourceFile(
    'codexViewComponents.ts',
    [
      'function renderDuration(minutes: number) { return `${minutes}m`; }',
      'function renderCoverage(count: number, size: number) {',
      '  return `<p>${count} files · ${size} bytes</p>`;',
      '}',
      "function renderText() { return '5 files'; }",
      'const renderArrow = () => `<button aria-label="5 files">ok</button>`;',
      'class Renderer {',
      '  renderMethod() { return `<span title="2 bytes">ok</span>`; }',
      '}',
    ].join('\n'),
    ts.ScriptTarget.ES2020,
    true,
  );
  assert.equal(hardcodedCodexRenderCopyViolations(hardcodedRenderer).length, 5);

  const nonRendererDataLogic = ts.createSourceFile(
    'codexViewComponents.ts',
    "function countFiles() { return '5 files'; }",
    ts.ScriptTarget.ES2020,
    true,
  );
  assert.deepEqual(hardcodedCodexRenderCopyViolations(nonRendererDataLogic), []);
  const otherProductionFile = ts.createSourceFile(
    'codexUsage.ts',
    "function renderCount() { return '5 files'; }",
    ts.ScriptTarget.ES2020,
    true,
  );
  assert.deepEqual(hardcodedCodexRenderCopyViolations(otherProductionFile), []);
});

test('Codex production rendering is owned by the provider-aware webview functions', () => {
  const components = ts.createSourceFile(
    'src/codexViewComponents.ts',
    repoFile('src/codexViewComponents.ts'),
    ts.ScriptTarget.ES2020,
    true,
  );
  assert.deepEqual(hardcodedCodexRenderCopyViolations(components), []);
  const componentFunctions = components.statements
    .filter(ts.isFunctionDeclaration)
    .map((statement) => statement.name?.text)
    .filter(Boolean);
  assert.deepEqual(
    componentFunctions.filter((name) => name?.startsWith('renderCodex')),
    [],
  );

  const webview = repoFile('src/webview.ts');
  for (const renderer of [
    'renderTodayData',
    'renderMonthData',
    'renderAllTimeData',
    'renderSessionData',
    'renderProjectData',
    'renderContentData',
    'renderCompositionChart',
  ]) {
    assert.match(webview, new RegExp(`private ${renderer}\\([\\s\\S]*?provider: SettingProvider`));
  }
  assert.match(webview, /renderSettingsPanel\(provider: SettingProvider\)/);
  assert.doesNotMatch(webview, /renderCodexView|getCodexViewStyles|getCodexClientScript/);
});

test('Codex schema 3 persistence uses semantic AST gates across the complete DTO graph', () => {
  const sources = projectSourceFiles('src');
  const project = projectFromSources(sources);
  const index = project.files.find((file) => file.fileName === 'src/providers/codex/codexIndex.ts');
  assert.ok(index, 'missing codexIndex source');

  assert.deepEqual(persistedPropertyViolations(project, 'CodexIndexV3'), []);
  assert.deepEqual(sanitizedDtoViolations(index), []);

  const codexFiles = project.files.filter((file) =>
    file.fileName.startsWith('src/providers/codex/'),
  );
  assert.deepEqual(legacyStructuralViolations(codexFiles), []);
  assert.deepEqual(
    misleadingCopyViolations([
      project.files.find((file) => file.fileName === 'src/codexView.ts')!,
      project.files.find((file) => file.fileName === 'src/i18n.ts')!,
    ]),
    [],
  );
});

test('Codex schema 3 production files are regular files and the architecture records its persisted contract', () => {
  const productionFiles = [
    'src/providers/codex/codexDedup.ts',
    'src/providers/codex/codexIdentity.ts',
    'src/providers/codex/codexIndex.ts',
    'src/providers/codex/codexIndexClient.ts',
    'src/providers/codex/codexIndexWorker.ts',
    'src/providers/codex/codexInsights.ts',
    'src/providers/codex/codexJsonlScanner.ts',
    'src/providers/codex/codexLineage.ts',
    'src/providers/codex/codexManifest.ts',
    'src/providers/codex/codexParser.ts',
    'src/providers/codex/codexPeriodIndex.ts',
    'src/providers/codex/codexProvider.ts',
    'src/providers/codex/codexSchema.ts',
    'src/providers/codex/codexUsage.ts',
    'src/providers/codex/codexWorkerProtocol.ts',
  ];
  const staged = execFileSync('git', ['ls-files', '--stage', '--', ...productionFiles], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const modes = new Map(
    staged.trim().split('\n').filter(Boolean).map((line) => {
      const [mode, , , file] = line.split(/\s+/, 4);
      return [file, mode];
    }),
  );
  for (const file of productionFiles) {
    assert.equal(modes.get(file), '100644', `${file} must be mode 100644`);
  }

  const english = repoFile('ARCHITECTURE.md');
  const chinese = repoFile('ARCHITECTURE-zh-CN.md');
  for (const [document, patterns] of [
    [english, [
      /schema 3[\s\S]*codex-index-v1\.json/i,
      /all-time[\s\S]*verified aggregate[\s\S]*period slices/i,
      /asOfDay[\s\S]*7[\s\S]*30[\s\S]*all-time/i,
      /16,384 file passes[\s\S]*64 GiB[\s\S]*64 file passes[\s\S]*128 MiB[\s\S]*512 file passes[\s\S]*2 GiB[\s\S]*1 MiB \+ 1[\s\S]*reads use 1 MiB chunks[\s\S]*line is capped at[\s\S]*1 MiB[\s\S]*10 seconds[\s\S]*2 GiB[\s\S]*256 completed file passes[\s\S]*derived lineage[\s\S]*period and[\s\S]*stable stages/i,
      /SSH[\s\S]*HTTPS[\s\S]*canonical/i,
      /strictly exact[\s\S]*active\/archive[\s\S]*ambiguous/i,
      /five structural call proxies[\s\S]*not file, command, or review counts/i,
      /never[\s\S]*stores a raw incomplete line or a carry buffer/i,
      /ordered numeric-event fingerprint[\s\S]*missing-parent/i,
      /cancellation checkpoints[\s\S]*resumes/i,
    ]],
    [chinese, [
      /内部 schema 3[\s\S]*codex-index-v1\.json/,
      /已验证的[\s\S]*aggregate[\s\S]*期间切片/,
      /asOfDay[\s\S]*7 天[\s\S]*30 天[\s\S]*all-time/,
      /16,384 次文件遍历[\s\S]*64 GiB[\s\S]*64 次文件遍历[\s\S]*128 MiB[\s\S]*512 次文件遍历[\s\S]*2 GiB[\s\S]*1 MiB \+ 1[\s\S]*读取 chunk 为 1 MiB[\s\S]*line 上限为 1 MiB[\s\S]*10 秒[\s\S]*2 GiB[\s\S]*256 个完成的[\s\S]*只有可能改变 lineage 的阶段[\s\S]*period 和稳定阶段/,
      /SSH[\s\S]*HTTPS[\s\S]*规范化/,
      /active\/archive[\s\S]*严格精确[\s\S]*歧义/,
      /五个结构调用代理量[\s\S]*不是文件、命令或审阅次数/,
      /v3 不保存未完成原始行，[\s\S]*也不保存 carry buffer/,
      /有序的数字事件指纹[\s\S]*missing-parent/,
      /cancel checkpoint[\s\S]*resume/,
    ]],
  ] as Array<[string, RegExp[]]>) {
    for (const pattern of patterns) {
      assert.match(document, pattern);
    }
  }
});

test('git and VSIX ignores exclude private and development-only material', () => {
  const gitIgnore = activePatterns('.gitignore');
  for (const pattern of ['out', 'node_modules', '*.vsix', '.env', '.env.*', 'secrets.json', 'CLAUDE.local.md', 'docs/', '.claude/', '.agents/', '.codex/', '.worktrees/']) {
    assert.ok(gitIgnore.has(pattern), `.gitignore missing ${pattern}`);
  }

  const vscodeIgnore = activePatterns('.vscodeignore');
  for (const pattern of ['.github/**', 'src/**', 'out/test/**', 'AGENTS.md', 'AGENTS.zh-CN.md', 'CLAUDE.md', 'CLAUDE.local.md', 'CONTRIBUTING.md', 'docs/**', '.claude/**', '.agents/**', '.codex/**', '.worktrees/**', '.env', '**/.env', '**/.env.*', '**/secrets.json', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx']) {
    assert.ok(vscodeIgnore.has(pattern), `.vscodeignore missing ${pattern}`);
  }
});

test('all seven README files credit both development tools', () => {
  const readmes = [
    'README.md',
    'README-en.md',
    'README-zh-CN.md',
    'README-zh-TW.md',
    'README-ja.md',
    'README-ko.md',
    'README-id.md',
  ];
  for (const readme of readmes) {
    const body = repoFile(readme);
    assert.match(body, /https:\/\/claude\.com\/claude-code/, `${readme} missing Claude Code credit`);
    assert.match(body, /https:\/\/developers\.openai\.com\/codex\//, `${readme} missing OpenAI Codex credit`);
  }
});

test('all seven README editions explain Codex Beta in their own language', () => {
  const expectations: Record<string, RegExp[]> = {
    'README.md': [/Codex Beta/, /processed/i, /uncached usage/i, /cached/i, /last-observed/i],
    'README-en.md': [/Codex Beta/, /processed/i, /uncached usage/i, /cached/i, /last-observed/i],
    'README-zh-CN.md': [/Codex Beta/, /已处理/, /未缓存用量/, /缓存/, /最后观测/],
    'README-zh-TW.md': [/Codex Beta/, /已處理/, /未快取用量/, /快取/, /最後觀測/],
    'README-ja.md': [/Codex Beta/, /処理済み/, /非キャッシュ使用量/, /キャッシュ/, /最終観測/],
    'README-ko.md': [/Codex Beta/, /처리된/, /캐시되지 않은 사용량/, /캐시/, /마지막 관측/],
    'README-id.md': [/Codex Beta/, /diproses/i, /penggunaan tanpa cache/i, /cache/i, /terakhir diamati/i],
  };

  for (const [readme, patterns] of Object.entries(expectations)) {
    const body = repoFile(readme);
    for (const pattern of patterns) {
      assert.match(body, pattern, `${readme} is missing ${pattern}`);
    }
    assert.doesNotMatch(body, /showOpusWeekly/, `${readme} still documents the retired setting key`);
  }
});

test('Marketplace metadata presents Claude and Codex local usage support', () => {
  const packageJson = JSON.parse(repoFile('package.json')) as {
    description: string;
    keywords: string[];
  };
  assert.match(packageJson.description, /Claude.*Codex|Codex.*Claude/i);
  assert.ok(packageJson.keywords.includes('codex'));
  assert.ok(packageJson.keywords.includes('openai'));
  assert.ok(packageJson.keywords.includes('local-usage'));
});

test('pull request checklist names the actual eight UI locales', () => {
  const packageJson = JSON.parse(repoFile('package.json')) as {
    contributes: { configuration: { properties: Record<string, { enum?: string[] }> } };
  };
  const languageValues = packageJson.contributes.configuration.properties['claudeCodeUsage.language'].enum ?? [];
  assert.equal(languageValues.filter((value) => value !== 'auto').length, 8);

  const template = repoFile('.github/PULL_REQUEST_TEMPLATE.md');
  assert.match(template, /all eight UI locales/);
  assert.doesNotMatch(template, /all seven languages/);
  assert.match(template, /all seven README editions/);
});

test('changelog records the V2.2.2 energy patch after the released V2.2.1 baseline', () => {
  const changelog = repoFile('CHANGELOG.md');
  assert.match(changelog, /^## \[2\.2\.2\] — Unreleased$/m);
  assert.match(changelog, /^## \[2\.2\.1\] — 2026-07-18$/m);
  assert.match(changelog, /Suspend polling and file watchers in\s+unfocused VS Code windows/);
  assert.match(changelog, /Back off repeated quota authentication failures/);
  assert.match(changelog, /^## \[2\.2\.0\] — 2026-07-07$/m);
  assert.match(changelog, /OpenAI Codex/);
  assert.doesNotMatch(changelog, /^## \[2\.2\.[01]\] — Unreleased$/m);
});

test('changelog records the v2.3.0 candidate', () => {
  const changelog = repoFile('CHANGELOG.md');
  assert.match(changelog, /^## \[2\.3\.0\] — Unreleased$/m);
});

test('release announcements are exact-version and user-disableable', () => {
  const extension = repoFile('src/extension.ts');
  const settings = repoFile('src/settings.ts');

  assert.match(extension, /'2\.3\.0'/);
  assert.doesNotMatch(extension, /'2\.2'\s*:/);
  assert.match(settings, /key:\s*'releaseAnnouncements'/);
  assert.match(settings, /default:\s*true/);
});
test('Codex beta settings use safe provider-aware defaults', () => {
  const settings = repoFile('src/settings.ts');
  const webview = repoFile('src/webview.ts');
  const packageJson = repoFile('package.json');

  assert.match(settings, /key:\s*'codex\.enabled'[\s\S]*?default:\s*true/);
  assert.match(settings, /key:\s*'codex\.fileWatchSeconds'[\s\S]*?default:\s*'30'/);
  assert.match(settings, /key:\s*'statusBarProvider'[\s\S]*?default:\s*'auto'/);
  assert.match(settings, /key:\s*'codex\.statusMetric'[\s\S]*?default:\s*'fresh'/);
  assert.match(settings, /key:\s*'codex\.optimization\.enabled'[\s\S]*?default:\s*true/);
  assert.match(webview, /'general'[\s\S]*?'providers'[\s\S]*?'features'/);
  assert.match(packageJson, /claudeCodeUsage\.codex\.dataDirectory/);
  assert.doesNotMatch(settings, /codex\.(?:auth|telemetry)/i);
});

test('package lock and Codex UI tooling stay exact and release-safe', () => {
  const pkg = JSON.parse(repoFile('package.json')) as {
    version: string;
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(repoFile('package-lock.json')) as {
    packages: Record<string, {
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>;
  };
  const root = lock.packages[''];

  assert.equal(pkg.devDependencies['@playwright/test'], '1.61.1');
  assert.equal(pkg.devDependencies['@axe-core/playwright'], '4.12.1');
  assert.equal(root.version, pkg.version);
  assert.deepEqual(root.devDependencies, pkg.devDependencies);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(root.dependencies, undefined);
  assert.equal(pkg.scripts.test, 'npm run test:node');
  assert.equal(
    pkg.scripts['test:node'],
    'npm run compile && node --test out/test/*.test.js .github/scripts/*.test.mjs',
  );
  assert.equal(pkg.scripts['test:ui'], 'npm run compile && playwright test');
  assert.equal(
    pkg.scripts['test:ui:update'],
    'npm run compile && playwright test --update-snapshots',
  );
  assert.equal(pkg.scripts['test:release'], 'npm run test:node && npm run test:ui');
});

test('Playwright sources stay tracked but never enter the VSIX', () => {
  const gitIgnore = activePatterns('.gitignore');
  const vscodeIgnore = activePatterns('.vscodeignore');

  for (const pattern of ['test-results/', 'playwright-report/']) {
    assert.ok(gitIgnore.has(pattern), `.gitignore missing ${pattern}`);
  }
  for (const pattern of [
    'tests/**',
    'playwright.config.mjs',
    'test-results/**',
    'playwright-report/**',
  ]) {
    assert.ok(vscodeIgnore.has(pattern), `.vscodeignore missing ${pattern}`);
  }
  assert.equal(gitIgnore.has('tests/'), false);
  assert.equal(gitIgnore.has('tests/**'), false);
});

test('CI has separate Node, browser, and package release gates', () => {
  const workflow = repoFile('.github/workflows/test.yml');
  const runs = workflowStepValues(workflow, 'run');
  const uses = workflowStepValues(workflow, 'uses');
  const runValues = runs.map(({ value }) => value);
  const browserInstall = /(?:^|\s)(?:npx\s+(?:-y\s+)?(?:@playwright\/test(?:@[^\s]+)?|playwright)|npm\s+exec\s+(?:--\s+)?playwright|playwright)\s+install(?:\s|$)/;

  assert.match('npx -y @playwright/test@1.61.1 install chromium', browserInstall);
  assert.doesNotMatch('npx playwright test', browserInstall);
  assert.deepEqual(workflowStepValues('# run: npx -y @vscode/vsce@3.9.1 package', 'run'), []);
  assert.throws(
    () => assertExactVscePin([{ value: 'npx -y @vscode/vsce@latest package', line: 1 }]),
    /unexpected VSCE invocation/,
  );

  assert.match(workflow, /^name:\s*Test\s*$/m);
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^  push:\s*$/m);
  assert.match(workflow, /^      - main\s*$/m);
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^permissions:\s*\n  contents:\s*read\s*$/m);
  assert.match(workflow, /^  test:\s*$/m);
  assert.match(workflow, /^  ui:\s*$/m);
  assert.match(workflow, /^  package:\s*$/m);
  assert.match(workflow, /^    name:\s*Node Tests\s*$/m);
  assert.match(workflow, /^    name:\s*UI Test\s*$/m);
  assert.match(workflow, /^    name:\s*Release Package\s*$/m);
  assert.match(workflow, /image:\s*mcr\.microsoft\.com\/playwright:v1\.61\.1-noble/);
  assert.match(workflow, /PLAYWRIGHT_BROWSERS_PATH:\s*\/ms-playwright/);
  assert.match(workflow, /needs:\s*\[test, ui\]/);
  assert.ok(runValues.includes('npm run test:ui'));
  const packageAt = runValues.indexOf('npx -y @vscode/vsce@3.9.1 package --out /tmp/claude-code-usage-ci.vsix');
  const verifyAt = runValues.indexOf('node .github/scripts/verify-vsix.mjs /tmp/claude-code-usage-ci.vsix');
  assert.ok(packageAt >= 0 && verifyAt > packageAt, 'smoke VSIX verification must follow packaging');
  assertExactVscePin(runs);
  assert.equal(
    uses.some(({ value }) => /^actions\/(?:upload|download)-artifact@/.test(value)),
    false,
    'CI must not exchange build artifacts between jobs',
  );
  assert.doesNotMatch(
    runValues.join('\n'),
    browserInstall,
  );
  assert.doesNotMatch(workflow, /<pinned-[s]ha>/);
});

test('publish pins the Node-20-compatible VSCE and verifies before publishing', () => {
  const workflow = repoFile('.github/workflows/publish.yml');
  const runs = workflowStepValues(workflow, 'run');
  const uses = workflowStepValues(workflow, 'uses');
  const findRun = (value: string): WorkflowStepValue | undefined =>
    runs.find((entry) => entry.value === value);

  assert.match(workflow, /node-version:\s*'20'/);
  const packageStep = findRun('npx -y @vscode/vsce@3.9.1 package --out claude-code-usage.vsix');
  const verifyStep = findRun('node .github/scripts/verify-vsix.mjs claude-code-usage.vsix');
  const publishStep = findRun('npx -y @vscode/vsce@3.9.1 publish --packagePath claude-code-usage.vsix --pat "$VSCE_PAT"');
  const openVsxStep = findRun('npx -y ovsx publish claude-code-usage.vsix --pat "$OVSX_PAT"');
  const attachStep = uses.find(({ value }) =>
    value === 'softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65',
  );
  assert.ok(packageStep && verifyStep && verifyStep.line > packageStep.line, 'VSIX verification must follow packaging');
  assert.ok(publishStep && publishStep.line > verifyStep.line, 'VSIX verification must precede Marketplace publish');
  assert.ok(openVsxStep && openVsxStep.line > verifyStep.line, 'VSIX verification must precede Open VSX publish');
  assert.ok(attachStep && attachStep.line > verifyStep.line, 'VSIX verification must precede Release attachment');
  assertExactVscePin(runs);
  assert.match(workflow, /RELEASE_TAG:[\s\S]*github\.event\.release\.tag_name[\s\S]*inputs\.tag/);
  assert.ok(runs.some(({ value }) => value.includes('npm version "$VER" --no-git-tag-version --allow-same-version')));
});

test('CONTRIBUTING documents provider-aware privacy and three testing layers', () => {
  const guide = repoFile('CONTRIBUTING.md');

  assert.match(guide, /Codex Beta is enabled by default and can be turned off in provider settings\./);
  assert.doesNotMatch(guide, /(?:opt-in[\s\S]{0,80}Codex Beta|Codex Beta[\s\S]{0,80}opt-in)/i);
  assert.doesNotMatch(guide, /Claude-only|Multi-provider monitoring[^\n]*out of scope/i);
  assert.match(guide, /Usage ingestion is read-only, and Codex data is never mutated\./);
  assert.match(guide, /Claude session actions are separately gated and disabled by default\./);
  assert.match(guide, /they can resume or delete a selected session\./);
  assert.match(guide, /Deleting the selected session moves its log to the OS trash\./);
  assert.match(guide, /Codex does not estimate\s+dollar cost/i);
  assert.match(
    guide,
    /usage JSONL is streamed and temporarily parsed for allowlisted\s+metadata/i,
  );
  assert.match(
    guide,
    /conversation fields are not inspected or used for analysis and are never\s+retained/i,
  );
  assert.doesNotMatch(guide, /never reads conversation bodies/i);
  assert.match(guide, /limits are last-observed\s+values from local logs, not real-time billing\s+data/i);

  const testsStart = guide.indexOf('## Tests');
  const testsEnd = guide.indexOf('## Releases');
  assert.ok(testsStart >= 0 && testsEnd > testsStart, 'CONTRIBUTING must retain a Tests section');
  const testing = guide.slice(testsStart, testsEnd);
  const nodeAt = testing.indexOf('`npm test`');
  const browserAt = testing.indexOf('`npm run test:ui`');
  const hostAt = testing.indexOf('**F5**');
  assert.ok(nodeAt >= 0 && browserAt > nodeAt && hostAt > browserAt, 'testing layers must be documented in order');
  assert.match(testing, /npm test[\s\S]*TypeScript compile[\s\S]*Node logic and repository-policy tests/i);
  assert.match(testing, /npm run test:ui[\s\S]*real, complete Webview[\s\S]*Chromium/i);
  for (const requirement of [/interaction/i, /reload/i, /Axe/, /eight-locale overflow/i, /visual baseline/i]) {
    assert.match(testing, requirement);
  }
  assert.match(testing, /F5[\s\S]*install[^\n]*VSIX[\s\S]*real\s+VS Code host activation[\s\S]*real local metadata[\s\S]*theme smoke/i);
  assert.match(testing, /does not replace the first two layers/i);
  assert.match(testing, /separate gates, with packaging after both test jobs pass/i);
  assert.doesNotMatch(testing, /gates independently/i);
  assert.match(testing, /mcr\.microsoft\.com\/playwright:v1\.61\.1-noble/);
  assert.match(testing, /macOS[\s\S]*must not[\s\S]*Linux snapshot/i);

  assert.match(guide, /controlled, comment-only\s+first pass/i);
  assert.match(guide, /Codex automatic attribution is not enabled in v2\.2\.1/);
  assert.match(guide, /Codex automatic attribution remains disabled in v2\.3\.0/);
  assert.match(guide, /separately\s+implemented and trusted OpenAI\/Codex transport/i);
  assert.match(guide, /v2\.2\.1 does not migrate this privileged workflow to Codex/);
  assert.match(guide, /v2\.3\.0 still does not migrate this privileged workflow to Codex/);
});
