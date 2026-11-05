import ts from 'typescript';
import path from 'node:path';
const controls = new Set(['Pressable', 'Button', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TouchableNativeFeedback', 'TextInput', 'Switch']);
const typography = new Set(['fontFamily', 'fontSize', 'lineHeight', 'fontWeight']);
const persistence = ['expo-sqlite', '@react-native-async-storage/async-storage', 'expo-file-system', '@tauri-apps/plugin-fs'];
const appearanceFields = new Set(['writingMode', 'font', 'fontSize', 'lineHeight', 'letterSpacing']);
const documentTags = new Set(['div', 'span', 'figure', 'figcaption', 'img']);
const documentFlowTags = new Set(['section', 'header', 'figure', 'figcaption', 'img', 'canvas']);
const imageTags = new Set([...documentTags, 'canvas']);
const adornmentTags = new Set(['span', 'svg', 'path']);

export function checkSource(filename, source) {
  const file = filename.replaceAll('\\', '/');
  const owner = file.startsWith('packages/ui/');
  const feature = file.includes('/src/features/');
  const host = file.includes('/src/host/') || file.includes('/modules/');
  const bootstrap = file.includes('/src/bootstrap/');
  const documentCanvas = file === 'apps/client/src/features/reader/DocumentCanvas.tsx';
  const imageCanvas = file === 'apps/client/src/features/reader/ImageCanvas.tsx';
  const sourceCanvas = documentCanvas || imageCanvas;
  const documentFlow = file === 'packages/ui/src/InlineWordDocument.tsx';
  const adornment = file === 'packages/ui/src/LevelStars.web.tsx';
  const isolatedDocument = [
    'packages/ui/src/Document.tsx', 'packages/ui/src/InlineWordDocument.tsx',
    'packages/ui/src/InlineWordElement.web.tsx', 'packages/ui/src/InlineWord.types.ts',
    'packages/ui/src/readingSegments.ts', 'packages/ui/src/SourceImage.tsx',
    'packages/ui/src/LevelStars.web.tsx', 'packages/ui/src/LevelStars.types.ts',
  ].includes(file);
  const dom = sourceCanvas || documentFlow || adornment || file === 'apps/client/src/host/MediaPlayer.web.tsx'
    || file === 'packages/ui/src/InlineWordControl.web.tsx' || file === 'packages/ui/src/InlineWordElement.web.tsx'
    || file === 'packages/ui/src/SourceImage.tsx';
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
    if (isolatedDocument && !new Set(['react', '@mlearn/contracts', './InlineWord.types',
      './InlineWordDocument', './InlineWordElement.web', './readingSegments', './SourceImage',
      './LevelStars.web', './LevelStars.types']).has(specifier))
      fail(node, 'Isolated document controls consume display data without booting a native theme registry.');
    if (sourceCanvas && specifier === '@mlearn/ui/inline-word')
      fail(node, 'Use the theme-free shared document entry inside the native DOM runtime.');
    if (sourceCanvas && (specifier.startsWith('@mlearn/runtime-client') || /(?:^|\/)(?:host|bootstrap)(?:\/|$)/.test(specifier))) fail(node, 'Document DOM receives display data, not runtime or host services.');
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
      if (!owner && specifier === 'react-native' && !(ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly)) {
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
        if (ts.isImportDeclaration(node) && node.importClause?.name) fail(node, 'Native default imports hide shared text/control bypasses; import named layout primitives.');
        if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
          for (const element of bindings.elements) if (!element.isTypeOnly && (controls.has((element.propertyName ?? element.name).text) || (element.propertyName ?? element.name).text === 'Text')) fail(element, 'Native text and interactive primitives belong in @mlearn/ui.');
        } else if (bindings || ts.isExportDeclaration(node)) fail(node, 'Namespace/wildcard native imports hide shared text/control bypasses; import named layout primitives.');
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast);
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || callee === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        checkImport(node, node.arguments[0].text);
        if (!owner && node.arguments[0].text === 'react-native') fail(node, 'Use named native layout imports; dynamic native access bypasses shared text/control ownership.');
      }
      if (!dom && /(?:^|\.)createElement$/.test(callee) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) fail(node, 'DOM elements belong in the document renderer, not universal UI.');
      if ((sourceCanvas || documentFlow || adornment) && /(?:^|\.)createElement$/.test(callee) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
        && !(adornment ? adornmentTags.has(node.arguments[0].text) : imageCanvas ? imageTags.has(node.arguments[0].text) : documentCanvas
          ? documentTags.has(node.arguments[0].text) : documentFlowTags.has(node.arguments[0].text))) fail(node, 'Document markup does not replace shared semantic controls.');
    }
    if (feature && (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))) {
      const name = ts.isComputedPropertyName(node.name) ? node.name.expression : node.name;
      if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && typography.has(name.text)) {
        const object = node.parent;
        const parent = object.parent;
        const acceptedAppearance = file === 'apps/client/src/features/reader/ReaderScreen.tsx'
          && ts.isObjectLiteralExpression(object) && ts.isCallExpression(parent)
          && parent.expression.getText(ast) === 'changeAppearance' && parent.arguments[0] === object
          && object.properties.every(property => ts.isPropertyAssignment(property)
            && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            && appearanceFields.has(property.name.text));
        const acceptedDisplay = (file === 'apps/client/src/features/reader/DocumentViewport.tsx'
          || file === 'apps/client/src/features/reader/ImageViewport.tsx')
          && name.text === 'fontFamily' && ts.isPropertyAssignment(node)
          && node.initializer.getText(ast) === 'theme.typography.body._web.fontFamily'
          && ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)
          && parent.parent.name.getText(ast) === 'display';
        const imageStyle = imageCanvas && ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)
          && parent.parent.name.getText(ast) === 'style' ? parent.parent.parent.parent : null;
        const sourceRegion = imageStyle && (ts.isJsxOpeningElement(imageStyle) || ts.isJsxSelfClosingElement(imageStyle))
          && imageStyle.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
            && attribute.name.getText(ast) === 'data-ocr-region');
        const measuredSourceSize = imageCanvas && name.text === 'fontSize' && ts.isReturnStatement(parent)
          && ts.isBlock(parent.parent) && ts.isFunctionDeclaration(parent.parent.parent)
          && parent.parent.parent.name?.text === 'textStyle';
        const acceptedImageGeometry = measuredSourceSize || imageStyle && ts.isPropertyAssignment(node)
          && (name.text === 'fontFamily' && node.initializer.getText(ast) === 'display.fontFamily'
            || name.text === 'lineHeight' && node.initializer.getText(ast) === '1' && sourceRegion);
        if (!acceptedAppearance && !acceptedDisplay && !acceptedImageGeometry)
          fail(node, 'Feature typography belongs in shared theme/Text roles.');
      }
      if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'unstable_useExpoModulesBridge'
        && (!ts.isPropertyAssignment(node) || node.initializer.kind !== ts.SyntaxKind.FalseKeyword)) fail(node, 'Document native scripting bridge must remain disabled.');
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(ast);
      if (!dom && /^[a-z]/.test(name)) fail(node, 'Universal UI uses React Native primitives, not raw HTML.');
      if ((sourceCanvas || documentFlow || adornment) && /^[a-z]/.test(name)) {
        if (!(adornment ? adornmentTags.has(name) : imageCanvas ? imageTags.has(name) : documentCanvas ? documentTags.has(name) : documentFlowTags.has(name))) fail(node, 'Document markup does not replace shared semantic controls.');
        for (const attribute of node.attributes.properties) {
          const sourceGesture = imageCanvas && name === 'div' && ts.isJsxAttribute(attribute)
            && attribute.name.getText(ast) === 'onPointerDown'
            && node.attributes.properties.some(item => ts.isJsxAttribute(item) && item.name.getText(ast) === 'data-source-image');
          if (ts.isJsxAttribute(attribute) && /^(?:onClick|onDoubleClick|onPointerDown|onMouseDown|onTouchStart)$/.test(attribute.name.getText(ast))
            && !sourceGesture) fail(attribute, 'Document activation belongs to the shared inline control.');
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'role' && attribute.initializer
            && ts.isStringLiteral(attribute.initializer) && /^(?:button|link|checkbox|radio|switch|tab|combobox|menuitem)$/.test(attribute.initializer.text)) fail(attribute, 'Document controls belong to the shared semantic owner.');
        }
      }
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
