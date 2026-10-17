import ts from 'typescript';
import path from 'node:path';
const controls = new Set(['Pressable', 'Button', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TouchableNativeFeedback', 'TextInput', 'Switch']);
const persistence = ['expo-sqlite', '@react-native-async-storage/async-storage', 'expo-file-system', '@tauri-apps/plugin-fs'];

export function checkSource(filename, source) {
  const file = filename.replaceAll('\\', '/');
  const owner = file.startsWith('packages/ui/');
  const host = file.includes('/src/host/') || file.includes('/modules/');
  const bootstrap = file.includes('/src/bootstrap/');
  const dom = file.startsWith('packages/reader-dom/') || file === 'apps/client/src/host/MediaPlayer.web.tsx' || file === 'packages/ui/src/InlineWordControl.web.tsx';
  const errors = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const approved = new Set();
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('@mlearn/ui/')) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const entry of bindings.elements) approved.add(entry.name.text);
    }
  }
  const fail = (node, message) => {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    errors.push(`${file}:${line + 1}: ${message}`);
  };
  const checkImport = (node, specifier) => {
    if (!owner && (specifier.startsWith('@rn-primitives/') || specifier.startsWith('@expo/ui'))) fail(node, 'Use @mlearn/ui, not its underlying primitive library.');
    if (!host && (specifier.startsWith('@tauri-apps/') || specifier.includes('mlearn-native'))) fail(node, 'Native APIs belong in host adapters.');
    if (persistence.some((p) => specifier === p || specifier.startsWith(`${p}/`)) && !(file==='apps/client/src/host/createHost.native.ts' && specifier==='expo-file-system')) fail(node, 'Durable application storage belongs to Rust.');
    if (owner && /@mlearn\/runtime-client|\/features\/|\/host\//.test(specifier)) fail(node, 'UI primitives must not depend on application services.');
    if (!host && !bootstrap && /(?:^|\/)host\//.test(specifier)) fail(node, 'Inject runtime-client at bootstrap; do not import host implementation.');
    if (specifier.includes('/features/')) {
      const current = file.match(/\/features\/([^/]+)\//)?.[1];
      const target = specifier.match(/\/features\/([^/]+)(.*)$/);
      if (current && target && target[1] !== current && target[2] && target[2] !== '/index') fail(node, 'Cross-feature imports must use the public entry point.');
    }
    if (specifier.startsWith('.')) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const current = file.match(/\/features\/([^/]+)\//)?.[1];
      const target = resolved.match(/\/features\/([^/]+)\/(.+)/);
      if (current && target && target[1] !== current && target[2] !== 'index') fail(node, 'Cross-feature private import.');
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      checkImport(node, specifier);
      if (!owner && specifier === 'react-native') {
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
          for (const element of bindings.elements) if (controls.has((element.propertyName ?? element.name).text)) fail(element, 'Interactive native primitives belong in @mlearn/ui.');
        } else if (bindings) fail(node, 'Namespace/native default imports hide interactive primitives; import named layout primitives.');
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast);
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || callee === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) checkImport(node, node.arguments[0].text);
      if (!dom && /(?:^|\.)createElement$/.test(callee) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) fail(node, 'DOM elements belong in the document renderer, not universal UI.');
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(ast);
      if (!dom && /^[a-z]/.test(name)) fail(node, 'Universal UI uses React Native primitives, not raw HTML.');
      if (!owner && !approved.has(name) && controls.has(name.split('.').at(-1))) fail(node, 'Use the shared semantic control.');
      if (!owner && !dom && /^(?:View|Text|.*\.(?:View|Text))$/.test(name)) {
        for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && /^(onPress|onClick|onResponder|onStartShouldSetResponder)/.test(attribute.name.getText(ast))) fail(attribute, 'Do not turn static text/layout into an ad hoc control.');
      }
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && /\b(?:localStorage|sessionStorage)\b/.test(node.expression.getText(ast))) fail(node, 'Renderer persistence is not the application authority.');
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return errors;
}
