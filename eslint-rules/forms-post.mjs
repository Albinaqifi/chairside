// ESLint rule: a <form> never puts its fields in the URL (D-076, D-081). Type-aware.
//
//   <form action={saveNote}>                     allowed: a function (server action, form action)
//   <form method="post" action="/login">         allowed: posts to a URL, written out
//   <form method="post" action={LOGIN_URL}>      allowed: posts to a URL in a string variable
//   <form onSubmit={signIn}>                     reported: whenever the handler does not run, the
//                                                browser sends the fields in the page's own URL
//   <form action="/search">                      reported: without method="post", a GET
//   <form method="post" action="">               reported: empty, so the page's own URL
//   <form method="post" action={urlOrFunction}>  reported: typed as a string-or-function union,
//                                                any or unknown: lint cannot tell which it is
//   <form method={method} action="/login">       reported: the method must be written out
//   <form {...props}>                            reported: a spread could set action and method
//   <button formMethod="get">                    reported: replaces the form's method
//   <button formAction={save}>                   allowed: a function, as on a form
//   <button formAction="/x" formMethod="post">   allowed: a URL it posts to, written out
//   <button formAction="/search">                reported: the browser sends the form there with
//                                                the form's method, which lint cannot see (none, so
//                                                GET, when the form's action is a function)
//   <button {...props}>                          reported when the type of props may hold
//                                                formAction or formMethod (D-081)
//   import Form from 'next/form';                reported: its <Form> sends a URL action as a GET
//
// A form passes when its `action` is a function, or when it has a literal method="post" (any letter
// case) and a non-empty URL in `action`. A spread may come only before `action` and `method`: in
// JSX the last prop wins, so one after them could replace them. Telling a function from a URL
// needs TypeScript's view of the expression, so the rule runs where the type-aware rules run
// (TYPED_FILES in eslint.config.mjs).
//
// A button's or input's `formAction` is read as a form's `action` is, except that a value that may
// be missing passes: without one, the element sends the form the way the form says, and the form
// is checked on its own. A URL needs formMethod="post" written on the same element. A spread onto
// a button or input is reported, wherever it sits, when its type may hold either prop: any part of
// the type has a property of that name (any letter case), has an index signature, or is any,
// unknown or object; a generic type counts as its constraint. A component that spreads its props
// types them as Omit<ComponentProps<'button'>, 'formAction' | 'formMethod'> (D-081).
import ts from 'typescript';
import { importsValue, sourceText } from './import-paths.mjs';

/**
 * Next.js's <Form>, by every path the package publishes it under, with or without `.js`: next/form
 * (its .d.ts re-exports dist/client/form, the Pages Router's), dist/client/app-dir/form (the App
 * Router's, which a build puts in place of next/form), dist/api/form (a re-export of
 * dist/client/form, which an ESM build puts in its place), and their untyped copies under
 * dist/esm/. Not dist/client/form-shared: it holds helpers, not the component.
 */
const NEXT_FORM = /^next\/(?:form|dist\/(?:esm\/)?(?:api|client|client\/app-dir)\/form)(?:\.js)?$/;

/** The props that send a button's or input's form elsewhere, in lower case as HTML reads them. */
const SUBMITTER_PROPS = new Set(['formaction', 'formmethod']);

/** The parts of a prop's type that leave the prop out: React drops undefined and null. */
const MISSING = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;

/** Types that say nothing about the properties a value holds: any, unknown and object. */
const HOLDS_ANYTHING = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive;

/** A JSX attribute's name in lower case, as HTML reads it, or null for a spread or `a:b`. */
function attributeName(attribute) {
  return attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier'
    ? attribute.name.name.toLowerCase()
    : null;
}

/** An element written as an HTML tag (<form>), in lower case; null for a component (<Form>). */
function tagName(opening) {
  const name = opening.name;
  return name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name) ? name.name.toLowerCase() : null;
}

/** True for method="post" or formMethod="post" written as a string, in any letter case. */
function postsLiterally(attribute) {
  const value = attribute?.value;
  return (
    value?.type === 'Literal' &&
    typeof value.value === 'string' &&
    value.value.toLowerCase() === 'post'
  );
}

/** The text of a value written as a string: "…", {'…'}, or {`…`} without ${}. Otherwise null. */
function writtenText(value) {
  if (value.type === 'Literal' && typeof value.value === 'string') return value.value;
  const expression = value.type === 'JSXExpressionContainer' ? value.expression : null;
  if (expression?.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value;
  }
  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis[0].value.cooked;
  }
  return null;
}

const isString = (type) =>
  (type.flags & ts.TypeFlags.StringLike) !== 0 ||
  (type.isIntersection() && type.types.some(isString));
const isEmptyString = (type) => type.isStringLiteral() && type.value.trim() === '';
const isFunction = (type) => type.getCallSignatures().length > 0;

const formsPost = {
  meta: {
    type: 'problem',
    docs: { description: 'A form never puts its fields in the URL' },
    schema: [],
    messages: {
      noAction:
        'A form without `action` is sent to its page\'s own URL, and without `method="post"` as a ' +
        'GET with every field in the URL, whenever its onSubmit handler does not run. Give it a ' +
        'function as its action, or `method="post"` and the URL to post to in `action` (D-076).',
      emptyAction:
        "An empty `action` sends the form to its page's own URL, query string included. Name the " +
        'URL to post to, or give the form a function as its action (D-076).',
      unclearAction:
        'TypeScript types this `action` as `{{type}}`: it must always be a function, or always a ' +
        'URL. Type it as a function, or as a string with `method="post"` (D-076).',
      notPost:
        'A form sent to a URL needs `method="post"`, written out as a string: with any other ' +
        'method the browser puts its fields in the URL (D-076).',
      spread:
        "A spread could set this form's `action` or `method`. Write `action` (and `method`) after " +
        'every spread: the last prop wins, and lint must see the ones the form gets (D-076).',
      formMethod:
        'A `formMethod` other than "post" puts the form\'s fields in the URL when this button or ' +
        'input submits it. Remove it, or write `formMethod="post"` (D-076).',
      formActionNotPost:
        "A `formAction` URL sends the form there with the form's own method, which lint cannot " +
        'see; a form whose action is a function has none, so a GET with every field in the URL. ' +
        'Write `formMethod="post"` on this element, or make `formAction` a function (D-081).',
      emptyFormAction:
        "An empty `formAction` sends the form to its page's own URL, query string included. Name " +
        'the URL to post to, or make `formAction` a function (D-081).',
      unclearFormAction:
        'TypeScript types this `formAction` as `{{type}}`: it must always be a function, or always ' +
        'a URL with `formMethod="post"`. Type it as one of the two (D-081).',
      submitterSpread:
        "This spread's type may hold `formAction` or `formMethod`, which send the form elsewhere " +
        "or as a GET. Type the props without them, as Omit<ComponentProps<'button'>, " +
        "'formAction' | 'formMethod'>, and write a function formAction out if needed (D-081).",
      nextForm:
        'Do not use next/form: its <Form> sends a URL action as a GET with every field in the URL, ' +
        'and with a function action it adds nothing to <form>. Use <form> (D-081).',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program) {
      throw new Error(
        'chairside/forms-post needs type information: enable it only for the files in the ' +
          'TypeScript project (TYPED_FILES in eslint.config.mjs).',
      );
    }
    const checker = services.program.getTypeChecker();

    /** A type's members: each part of a union, and a type parameter's constraint in its place. */
    function constituents(type) {
      if (type.isUnion()) return type.types.flatMap(constituents);
      if (type.flags & ts.TypeFlags.TypeParameter) {
        const constraint = checker.getBaseConstraintOfType(type);
        if (constraint && constraint !== type) return constituents(constraint);
      }
      return [type];
    }

    /**
     * What an `action` gives the form: a function, a URL, an empty one, none, or unclear. With
     * `missingPasses` (a button's or input's formAction), the parts of its type that leave the
     * prop out (undefined, null) are dropped first, and nothing left is `missing`.
     */
    function kindOfAction(value, missingPasses = false) {
      if (value === null) return { kind: 'missing' }; // <form action>: React drops a boolean action
      const text = writtenText(value);
      if (text !== null) return { kind: text.trim() === '' ? 'empty' : 'url' };
      const expression = value.type === 'JSXExpressionContainer' ? value.expression : value;
      if (expression.type === 'JSXEmptyExpression') return { kind: 'missing' };
      const type = services.getTypeAtLocation(expression);
      const parts = constituents(type).filter((part) => !missingPasses || !(part.flags & MISSING));
      if (parts.length === 0) return { kind: 'missing' };
      if (parts.every(isFunction)) return { kind: 'function' };
      if (parts.every(isString)) return { kind: parts.some(isEmptyString) ? 'empty' : 'url' };
      return { kind: 'unclear', type: checker.typeToString(type) };
    }

    /**
     * True if a spread of this type may give a button or input a formAction or formMethod: a part
     * of it is any, unknown or object, has an index signature, or has a property of either name in
     * any letter case. Each part of an intersection is read too; a generic type counts as its
     * constraint, and one without a constraint may hold anything. `object` is how a generic
     * component says "any props" (`P extends object`), so it counts as unknown does.
     */
    function mayCarrySubmitterProps(type) {
      return constituents(type).some((part) => {
        if (part.isIntersection()) return part.types.some(mayCarrySubmitterProps);
        if (part.flags & HOLDS_ANYTHING) return true;
        if (part.flags & ts.TypeFlags.Instantiable) {
          const constraint = checker.getBaseConstraintOfType(part);
          return !constraint || constraint === part || mayCarrySubmitterProps(constraint);
        }
        if (checker.getIndexInfosOfType(part).length > 0) return true;
        return checker
          .getPropertiesOfType(part)
          .some((property) => SUBMITTER_PROPS.has(property.getName().toLowerCase()));
      });
    }

    function checkForm(opening) {
      const attributes = opening.attributes;
      const lastIndex = (name) => attributes.findLastIndex((a) => attributeName(a) === name);
      const actionAt = lastIndex('action');
      const methodAt = lastIndex('method');
      const spreadAt = attributes.findLastIndex((a) => a.type === 'JSXSpreadAttribute');

      if (actionAt === -1) {
        context.report({ node: opening, messageId: spreadAt === -1 ? 'noAction' : 'spread' });
        return;
      }
      if (spreadAt > actionAt) {
        context.report({ node: attributes[spreadAt], messageId: 'spread' });
        return;
      }
      const action = attributes[actionAt];
      const { kind, type } = kindOfAction(action.value);
      switch (kind) {
        case 'function': // React sends the form itself, with a method and encoding of its own
          return;
        case 'missing':
          context.report({ node: action, messageId: 'noAction' });
          return;
        case 'empty':
          context.report({ node: action, messageId: 'emptyAction' });
          return;
        case 'unclear':
          context.report({ node: action, messageId: 'unclearAction', data: { type } });
          return;
        default: // a URL: the form must post to it
      }
      const method = methodAt === -1 ? null : attributes[methodAt];
      if (method && spreadAt > methodAt) {
        context.report({ node: attributes[spreadAt], messageId: 'spread' });
      } else if (!postsLiterally(method)) {
        context.report({ node: method ?? opening, messageId: 'notPost' });
      }
    }

    /** A button's or input's own URL: read as a form's action, but a missing one passes (D-081). */
    function checkFormAction(formAction, formMethod) {
      const { kind, type } = kindOfAction(formAction.value, true);
      switch (kind) {
        case 'function': // React sends the form itself
        case 'missing': // the form's own action applies, and the form is checked on its own
          return;
        case 'empty':
          context.report({ node: formAction, messageId: 'emptyFormAction' });
          return;
        case 'unclear':
          context.report({ node: formAction, messageId: 'unclearFormAction', data: { type } });
          return;
        default: // a URL: this element must post to it
      }
      if (!postsLiterally(formMethod)) {
        context.report({ node: formAction, messageId: 'formActionNotPost' });
      }
    }

    /** A button or input can submit its form with a method, or to a URL, of its own. */
    function checkSubmitter(opening) {
      const attributes = opening.attributes;
      const formMethod = attributes.findLast((a) => attributeName(a) === 'formmethod');
      if (formMethod && !postsLiterally(formMethod)) {
        context.report({ node: formMethod, messageId: 'formMethod' });
      }
      const formAction = attributes.findLast((a) => attributeName(a) === 'formaction');
      if (formAction) checkFormAction(formAction, formMethod);
      for (const attribute of attributes) {
        if (
          attribute.type === 'JSXSpreadAttribute' &&
          mayCarrySubmitterProps(services.getTypeAtLocation(attribute.argument))
        ) {
          context.report({ node: attribute, messageId: 'submitterSpread' });
        }
      }
    }

    /** next/form loaded by an import, a re-export, or import() with a written path (D-081). */
    function checkImport(node) {
      const source = sourceText(node.source);
      if (source !== null && NEXT_FORM.test(source) && importsValue(node)) {
        context.report({ node, messageId: 'nextForm' });
      }
    }

    return {
      JSXOpeningElement(opening) {
        const tag = tagName(opening);
        if (tag === 'form') checkForm(opening);
        else if (tag === 'button' || tag === 'input') checkSubmitter(opening);
      },
      ImportDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      ExportAllDeclaration: checkImport,
      ImportExpression: checkImport,
    };
  },
};

export default formsPost;
