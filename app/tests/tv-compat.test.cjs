'use strict';
// Checks that the TV screen uses only what the Chromium of config.xml's oldest Tizen supports.
// JS via ESLint (eslint-plugin-compat, eslint-plugin-es-x), CSS via MDN browser-compat-data.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

function loadDependencies() {
  try {
    return {
      Linter: require('eslint').Linter,
      compatPlugin: require('eslint-plugin-compat'),
      esXPlugin: require('eslint-plugin-es-x'),
      bcd: require('@mdn/browser-compat-data')
    };
  } catch (error) {
    // CI installs the devDependencies, so a missing one there is a broken install.
    if (error.code !== 'MODULE_NOT_FOUND' || process.env.CI) throw error;
    console.log('SKIP TV screen engine check: run npm install in app/ to check it');
    process.exit(0);
  }
}

const { Linter, compatPlugin, esXPlugin, bcd } = loadDependencies();

// TARGET ENGINE: every check below measures against the Chromium of config.xml's required_version.
// To move the floor, change required_version; add the Tizen version to CHROMIUM_BY_TIZEN if it is missing.

const CHROMIUM_BY_TIZEN = {
  '3.0': 47,
  '4.0': 56,
  '5.0': 63,
  '5.5': 69,
  '6.0': 76,
  '6.5': 85,
  '7.0': 94,
  '8.0': 108,
  '9.0': 120,
  '10.0': 130
};

function readRequiredTizenVersion(configFile) {
  const match = /required_version="([\d.]+)"/.exec(fs.readFileSync(configFile, 'utf8'));
  return match ? match[1] : undefined;
}

const APP_DIR = process.argv[2] || path.join(__dirname, '..');
const HTML_FILE = path.join(APP_DIR, 'index.html');
const TIZEN_VERSION = readRequiredTizenVersion(path.join(APP_DIR, 'config.xml'));
const TARGET_CHROME = CHROMIUM_BY_TIZEN[TIZEN_VERSION];
assert.ok(TARGET_CHROME, 'config.xml required_version ' + TIZEN_VERSION + ' is not in CHROMIUM_BY_TIZEN');

// es-x rule -> browser-compat-data feature it bans; a rule is on when the target Chrome predates its feature.
const ES_X_RULES = {
  'no-destructuring': 'javascript.operators.destructuring',
  'no-default-parameters': 'javascript.functions.default_parameters',
  'no-regexp-u-flag': 'javascript.builtins.RegExp.unicode',
  'no-regexp-y-flag': 'javascript.builtins.RegExp.sticky',
  'no-exponential-operators': 'javascript.operators.exponentiation',
  'no-async-functions': 'javascript.statements.async_function',
  'no-trailing-function-commas': 'javascript.grammar.trailing_commas.trailing_commas_in_functions',
  'no-async-iteration': 'javascript.statements.for_await_of',
  'no-rest-spread-properties': 'javascript.operators.spread.spread_in_object_literals',
  'no-regexp-lookbehind-assertions': 'javascript.regular_expressions.lookbehind_assertion',
  'no-regexp-named-capture-groups': 'javascript.regular_expressions.named_capturing_group',
  'no-regexp-s-flag': 'javascript.builtins.RegExp.dotAll',
  'no-regexp-unicode-property-escapes': 'javascript.regular_expressions.unicode_character_class_escape',
  'no-optional-catch-binding': 'javascript.statements.try_catch.optional_catch_binding',
  'no-optional-chaining': 'javascript.operators.optional_chaining',
  'no-nullish-coalescing-operators': 'javascript.operators.nullish_coalescing',
  'no-bigint': 'javascript.builtins.BigInt',
  'no-dynamic-import': 'javascript.operators.import',
  'no-logical-assignment-operators': 'javascript.operators.logical_or_assignment',
  'no-numeric-separators': 'javascript.grammar.numeric_separators',
  'no-class-instance-fields': 'javascript.classes.public_class_fields',
  'no-class-private-fields': 'javascript.classes.private_class_fields',
  'no-class-private-methods': 'javascript.classes.private_class_methods',
  'no-class-static-block': 'javascript.classes.static.initialization_blocks',
  'no-private-in': 'javascript.classes.private_class_fields_in',
  'no-regexp-d-flag': 'javascript.builtins.RegExp.hasIndices',
  'no-hashbang': 'javascript.grammar.hashbang_comments',
  'no-regexp-v-flag': 'javascript.builtins.RegExp.unicodeSets',
  'no-regexp-modifiers': 'javascript.regular_expressions.modifier',
  'no-regexp-duplicate-named-capturing-groups': 'javascript.regular_expressions.named_capturing_group.duplicate_named_capturing_groups',
  'no-promise-prototype-finally': 'javascript.builtins.Promise.finally',
  'no-global-this': 'javascript.builtins.globalThis'
};

// Features es-x only bans together with older ones (const, generator declarations), matched by selector instead.
const RESTRICTED_SYNTAX = [
  { label: 'let', selector: 'VariableDeclaration[kind="let"]', feature: 'javascript.statements.let' },
  { label: 'generator function expression', selector: 'FunctionExpression[generator=true]:not(Property[method=true] > FunctionExpression, MethodDefinition > FunctionExpression)', feature: 'javascript.operators.generator_function' }
];

// CSS value function trees in browser-compat-data, then the top-level types (var(), min()).
const CSS_FUNCTION_TREES = ['color', 'transform-function', 'gradient', 'easing-function', 'filter-function'].map(family => bcd.css.types[family]).concat(bcd.css.types);

// ---- browser-compat-data lookups ----
// A feature is { node, prefix }: a data node and the vendor prefix the source wrote it with ('' for none).

function ownChild(tree, key) {
  return tree && Object.prototype.hasOwnProperty.call(tree, key) ? tree[key] : undefined;
}

function featureAt(dataPath) {
  const node = dataPath.split('.').reduce(ownChild, bcd);
  assert.ok(node && node.__compat, 'browser-compat-data has no ' + dataPath);
  return { node, prefix: '' };
}

// The data node for a CSS name in the first tree that has it, as written or with its vendor prefix taken off.
function findCssFeature(trees, name) {
  const [, prefix, unprefixed] = /^(-(?:webkit|moz|ms|o)-)?(.*)$/.exec(name);
  for (const tree of trees) {
    if (ownChild(tree, name) && tree[name].__compat) return { node: tree[name], prefix: '' };
    if (prefix && ownChild(tree, unprefixed) && tree[unprefixed].__compat) return { node: tree[unprefixed], prefix };
  }
  return null;
}

function parseVersion(value) {
  if (value === true) return 0;
  return /^≤?[\d.]+$/.test(value) ? parseFloat(value.replace('≤', '')) : Infinity;
}

// A Chrome support entry that counts: no flag, not partial, not strict-mode only, same prefix, not removed by the target.
function isFullSupport(support, prefix) {
  const notes = [].concat(support.notes || []).join(' ');
  return !support.flags && !support.partial_implementation && !support.alternative_name && (support.prefix || '') === prefix && !/strict mode/i.test(notes) && !(parseVersion(support.version_removed) <= TARGET_CHROME);
}

// First Chrome version with full support for the feature; Infinity when Chrome never had it.
function chromeVersionAdded(feature) {
  const versions = [].concat(feature.node.__compat.support.chrome || []).filter(support => isFullSupport(support, feature.prefix)).map(support => parseVersion(support.version_added));
  return Math.min(Infinity, ...versions);
}

function chromeVersionAddedAt(dataPath) {
  return chromeVersionAdded(featureAt(dataPath));
}

function isNewerThanTarget(dataPath) {
  return chromeVersionAddedAt(dataPath) > TARGET_CHROME;
}

// ---- problems ----

const problems = [];

function report(where, message) {
  problems.push(where + ': ' + message);
}

function requireSupport(where, label, feature) {
  if (!feature) return report(where, label + ' is unknown to browser-compat-data');
  const version = chromeVersionAdded(feature);
  if (version > TARGET_CHROME) report(where, label + (version === Infinity ? ' (not in Chrome)' : ' (Chrome ' + version + ')'));
}

// ---- what index.html loads ----

function attributeValue(attributes, name) {
  const match = new RegExp('\\s' + name + '\\s*=\\s*["\']?([^"\'\\s>]*)', 'i').exec(attributes);
  return match ? match[1] : undefined;
}

// Files the app ships, as opposed to the platform's ($WEBAPIS/...) or remote URLs.
function isShippedFile(src) {
  return Boolean(src) && !/^([a-z][\w+.-]*:|\/\/|\$)/i.test(src);
}

function readShippedFile(src) {
  const file = path.join(APP_DIR, src);
  assert.ok(fs.existsSync(file), 'index.html loads ' + src + ', which is missing');
  return fs.readFileSync(file, 'utf8');
}

// Every script and stylesheet index.html loads, inline or from a shipped file, plus its style="" attributes.
function collectSources(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [];
  const styles = [];
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const type = attributeValue(attributes, 'type');
    const src = attributeValue(attributes, 'src');
    if (type && !/javascript$/i.test(type)) report('index.html', '<script type="' + type + '"> is not a classic script');
    if (isShippedFile(src)) scripts.push({ where: src, source: readShippedFile(src) });
    if (body.trim()) scripts.push({ where: 'index.html <script>', source: body });
  }
  for (const [, attributes] of html.matchAll(/<link\b([^>]*)>/gi)) {
    const href = attributeValue(attributes, 'href');
    const isStylesheet = /stylesheet/i.test(attributeValue(attributes, 'rel') || '');
    if (isStylesheet && isShippedFile(href)) styles.push({ where: href, source: readShippedFile(href) });
  }
  for (const [, body] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    styles.push({ where: 'index.html <style>', source: body });
  }
  const markup = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  for (const [, , declarations] of markup.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    styles.push({ where: 'index.html style=""', source: '{' + declarations + '}' });
  }
  return { scripts, styles };
}

// ---- JavaScript ----

function isStyleObject(node) {
  return node.type === 'MemberExpression' && !node.computed && node.property.name === 'style';
}

function stringLiteral(node) {
  return node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : '';
}

// element.style property name to CSS name: cssFloat -> float, webkitTransform -> -webkit-transform.
function cssPropertyName(styleProperty) {
  if (styleProperty === 'cssFloat') return 'float';
  return styleProperty.replace(/^(webkit|Webkit|moz|Moz|ms|o|O)(?=[A-Z])/, prefix => '-' + prefix.toLowerCase()).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
}

// Rules no published plugin has: class outside strict mode, and CSS written into element.style.
function localPlugin(onStyleWrite) {
  // Chrome had classes in strict code from 42, in sloppy code from 49.
  const classOutsideStrict = {
    create: context => {
      const check = node => {
        const scope = context.sourceCode.getScope(node);
        const enclosing = scope.type === 'class' ? scope.upper : scope;
        if (!enclosing.isStrict) context.report({ node, message: 'class outside strict mode (Chrome ' + chromeVersionAddedAt('javascript.classes') + ')' });
      };
      return { ClassDeclaration: check, ClassExpression: check };
    }
  };
  // Reports nothing; passes the CSS to onStyleWrite for the stylesheet checks.
  const styleWrites = {
    create: () => ({
      AssignmentExpression: node => {
        const target = node.left;
        if (target.type !== 'MemberExpression' || target.computed || !isStyleObject(target.object)) return;
        const value = stringLiteral(node.right);
        const name = target.property.name;
        onStyleWrite(node.loc.start.line, name === 'cssText' ? value : cssPropertyName(name) + ':' + value);
      },
      CallExpression: node => {
        const callee = node.callee;
        const isSetProperty = callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'setProperty' && isStyleObject(callee.object);
        if (!isSetProperty || !stringLiteral(node.arguments[0])) return;
        onStyleWrite(node.loc.start.line, stringLiteral(node.arguments[0]) + ':' + stringLiteral(node.arguments[1]));
      }
    })
  };
  return { rules: { 'class-outside-strict': classOutsideStrict, 'style-writes': styleWrites } };
}

function eslintRules() {
  const rules = { 'compat/compat': ['error', 'chrome ' + TARGET_CHROME], 'local/style-writes': 'error' };
  for (const [rule, dataPath] of Object.entries(ES_X_RULES)) {
    if (isNewerThanTarget(dataPath)) rules['es-x/' + rule] = 'error';
  }
  const restricted = RESTRICTED_SYNTAX.filter(syntax => isNewerThanTarget(syntax.feature));
  if (restricted.length) {
    rules['no-restricted-syntax'] = ['error', ...restricted.map(syntax => ({ selector: syntax.selector, message: syntax.label + ' (Chrome ' + chromeVersionAddedAt(syntax.feature) + ')' }))];
  }
  if (isNewerThanTarget('javascript.classes')) rules['local/class-outside-strict'] = 'error';
  return rules;
}

// Lints every script and returns the CSS they write into element.style, as stylesheets to check.
function lintScripts(scripts) {
  const linter = new Linter();
  const rules = eslintRules();
  const styleWrites = [];
  for (const script of scripts) {
    const onStyleWrite = (line, declarations) => styleWrites.push({ where: script.where + ':' + line, source: '{' + declarations + '}' });
    const config = {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
      plugins: { compat: compatPlugin, 'es-x': esXPlugin, local: localPlugin(onStyleWrite) },
      settings: { lintAllEsApis: true },
      rules
    };
    for (const message of linter.verify(script.source, config)) report(script.where + ':' + message.line, message.message);
  }
  return styleWrites;
}

// ---- CSS ----

// A style block opened inside another style block (at-rule blocks like @media don't count).
function checkNesting(where, css) {
  const openBlocks = [];
  let preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const isStyleBlock = !css.slice(preludeStart, i).trim().startsWith('@');
      if (isStyleBlock && openBlocks.includes('style')) requireSupport(where, 'CSS nesting', featureAt('css.selectors.nesting'));
      openBlocks.push(isStyleBlock ? 'style' : 'at-rule');
    }
    if (css[i] === '}') openBlocks.pop();
    if (/[{};]/.test(css[i])) preludeStart = i + 1;
  }
}

function checkAtRules(where, css) {
  for (const [, name] of css.matchAll(/@([\w-]+)/g)) requireSupport(where, '@' + name, findCssFeature([bcd.css['at-rules']], name));
}

function checkMediaQuery(where, query) {
  for (const [, name] of query.matchAll(/\(\s*([a-z-]+)\s*[:)]/gi)) {
    const feature = name.toLowerCase().replace(/^(min|max)-/, '');
    requireSupport(where, '@media ' + name, findCssFeature([bcd.css['at-rules'].media], feature));
  }
  if (/\([^()]*[<>=][^()]*\)/.test(query)) requireSupport(where, '@media range syntax', featureAt('css.at-rules.media.range_syntax'));
}

function checkSelector(where, selector) {
  const withoutAttributes = selector.replace(/\[[^\]]*\]/g, '');
  for (const [, colons, name] of withoutAttributes.matchAll(/(::?)([\w-]+)/g)) requireSupport(where, colons + name, findCssFeature([bcd.css.selectors], name));
  if (/:not\([^()]*,/i.test(withoutAttributes)) requireSupport(where, ':not() with a selector list', featureAt('css.selectors.not.selector_list'));
}

function checkPreludes(where, css) {
  for (const [, prelude] of css.matchAll(/([^{};]+)\{/g)) {
    if (/^\s*@media\b/i.test(prelude)) checkMediaQuery(where, prelude);
    if (!prelude.trim().startsWith('@')) checkSelector(where, prelude);
  }
}

// Chrome had gap for grids from 57, for flex boxes from 84: check the flex entry when the rule sets display: flex.
function checkFlexGap(where, declarations) {
  const gap = /(?:^|[;\s])((?:row-|column-)?gap)\s*:/.exec(declarations);
  const isFlexContainer = /(?:^|[;\s])display\s*:\s*(inline-)?flex\b/.test(declarations);
  if (gap && isFlexContainer) requireSupport(where, gap[1] + ' in a flex container', featureAt('css.properties.' + gap[1] + '.flex_context'));
}

function checkColourSyntax(where, value) {
  if (/#([0-9a-f]{4}|[0-9a-f]{8})\b/i.test(value)) requireSupport(where, 'hex colour with alpha, #rrggbbaa / #rgba', featureAt('css.types.color.rgb_hexadecimal_notation.alpha_hexadecimal_notation'));
  if (/\b(rgb|hsl)\([^,()]+,[^,()]+,[^,()]+,/i.test(value)) requireSupport(where, 'alpha inside rgb()/hsl(), use rgba()/hsla()', featureAt('css.types.color.rgb.alpha_parameter'));
  if (/\b(rgba?|hsla?)\(\s*[^,()]+\s+[^,()\s]/i.test(value)) requireSupport(where, 'space-separated rgb()/hsl()', featureAt('css.types.color.rgb.space_separated_parameters'));
}

function checkDeclaration(where, name, value) {
  if (name.startsWith('--')) return requireSupport(where, 'custom property ' + name, featureAt('css.properties.custom-property'));
  const property = findCssFeature([bcd.css.properties, bcd.css['at-rules']['font-face']], name);
  requireSupport(where, name, property);
  // Keyword values with data of their own sit under the property, like display.grid or position.sticky.
  for (const [, keyword] of value.matchAll(/(?:^|[^\w-])([a-z][\w-]*)(?![\w(-])/gi)) {
    const keywordNode = property && ownChild(property.node, keyword);
    if (keywordNode && keywordNode.__compat) requireSupport(where, name + ': ' + keyword, { node: keywordNode, prefix: '' });
  }
  // Unknown functions are skipped: the data lacks some standard ones (format(), rgba()).
  for (const [, fn] of value.matchAll(/(?:^|[^\w-])([a-z-]+)\(/gi)) {
    const feature = findCssFeature(CSS_FUNCTION_TREES, fn.toLowerCase());
    if (feature) requireSupport(where, fn + '()', feature);
  }
  checkColourSyntax(where, value);
}

function checkDeclarationBlocks(where, css) {
  for (const [, declarations] of css.matchAll(/\{([^{}]*)\}/g)) {
    checkFlexGap(where, declarations);
    for (const declaration of declarations.split(';').filter(part => part.includes(':'))) {
      const colon = declaration.indexOf(':');
      checkDeclaration(where, declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1));
    }
  }
}

function checkStylesheet(where, source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  checkNesting(where, css);
  checkAtRules(where, css);
  checkPreludes(where, css);
  checkDeclarationBlocks(where, css);
}

// ---- run ----

const { scripts, styles } = collectSources(HTML_FILE);
const styleWrites = lintScripts(scripts);
for (const style of styles.concat(styleWrites)) checkStylesheet(style.where, style.source);

const engine = 'Tizen ' + TIZEN_VERSION + ' (Chromium M' + TARGET_CHROME + ')';
assert.deepEqual(problems, [], 'the TV screen uses what ' + engine + ' lacks:\n  ' + problems.join('\n  '));
assert.ok(scripts.some(script => /function run\(\)/.test(script.source)) && styles.length > 0, 'the TV screen script and stylesheet were read');
console.log('PASS TV screen draws on Tizen ' + TIZEN_VERSION + ' (Chromium M' + TARGET_CHROME + ', browser-compat-data ' + bcd.__meta.version + ')');
