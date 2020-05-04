import { Expr, query as q, Client as FaunaClient } from 'faunadb';
import { FaunaObject } from 'src/types/fauna';
import {
  BiotaBuilderDefinition,
  BiotaBuilderDefinitionHandler,
  BiotaBuilderDefinitionKeyed,
  BiotaBuilderMethodOutputAPI,
  BiotaBuilderMethodOutputAPIKeyed,
  BiotaBuilderOptions,
  BiotaBuilderOptionsActionOptions,
} from './types/builder';
import { functionArgumentsNames } from './utils/functionArgumentsNames';

function functionToLet(this: any, fn: BiotaBuilderDefinitionHandler) {
  const self = this;
  return function (...args: any[]) {
    const params = functionArgumentsNames(fn);
    const bindings: any = {};
    for (const i of Object.keys(params)) {
      bindings[params[i]] = args[+i] || null;
    }
    return q.Let(
      bindings,
      fn.apply(
        self,
        params.map((param: string) => q.Var(param)),
      ),
    );
  };
}

function functionToExpresion(this: any, fn: BiotaBuilderDefinitionHandler, params: string[] = []) {
  return fn.apply(
    this,
    params.map((param: string) => q.Var(param)),
  );
}

function definitionMethodPath(path: string, name: string) {
  return typeof path === 'string' && path.length > 0 ? `${path}.${name}` : name;
}

function definitionUDFName(path: string, name: string) {
  const list = typeof path === 'string' && path.length > 0 ? [...path.split('.'), name] : [name];
  return list.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export class Builder {
  path: string;
  annotate: boolean;
  action: boolean;
  actionOptions: BiotaBuilderOptionsActionOptions;
  context: any;

  constructor(options?: BiotaBuilderOptions) {
    const { annotate = false, action = false, path = '', actionOptions = {}, context = {}, identity } = options || {};
    this.annotate = annotate;
    this.action = action;
    this.path = path;
    this.actionOptions = { collection: 'biota.actions', ...actionOptions };
    this.context = context;

    if (typeof identity === 'function') {
      this.identity = identity;
    } else {
      this.identity = (ctx) => q.If(q.HasIdentity(), q.Identity(), false);
    }
  }

  identity: (ctx: FaunaObject) => Expr;

  methods(definitionsObject: BiotaBuilderDefinitionKeyed): BiotaBuilderMethodOutputAPIKeyed {
    const definitions: BiotaBuilderMethodOutputAPIKeyed = {};
    for (const methodName of Object.keys(definitionsObject)) {
      definitions[methodName] = this.method(definitionsObject[methodName]);
    }
    return definitions;
  }

  method(definition: BiotaBuilderDefinition): BiotaBuilderMethodOutputAPI {
    const self = this;

    const { before, query, after, context = (ctx: any) => ctx } = definition || {};
    const methods = [before, query, after].filter((f) => typeof f === 'function');
    const paramsList = methods.map((method) => functionArgumentsNames(method));
    const params =
      definition.params ||
      paramsList.reduce((list, params) => {
        const isUnderscoreOnly = (item: string) => item.replace('_', '');
        if (list.length === 0) {
          list = params;
        } else {
          for (const i of Object.keys(list)) {
            list[i] = !isUnderscoreOnly(params[i]) ? params[i] : list[i];
          }
        }
        return list;
      }, []);

    const extend = (bindings: Object) => (next: Expr) => q.Let(bindings, next);

    const _pipe = (a: (i: any) => any, b: (i: any) => any) => (arg: any) => b(a(arg));
    const pipe = (...ops: ((i: any) => any)[]) => ops.reduce(_pipe);
    const compose = (...ops: ((i: any) => any)[]) => ops.reverse().reduce(_pipe);

    const methodPath = definitionMethodPath(definition.path, definition.name);
    const UDFName = definitionUDFName(definition.path, definition.name);
    let ctx: any = null;

    let api: BiotaBuilderMethodOutputAPI = {
      definition() {
        return definition;
      },
      context(ctxInUse) {
        ctx = ctxInUse;
        return api;
      },
      query(...args) {
        const inputs: any = {};
        for (const idx of Object.keys(args)) {
          if (!params[idx]) {
            throw new Error(`Either a parameter is missing or there are too many arguments (${args.length})`);
          }
          inputs[params[idx]] = args[idx];
        }

        const beforeLet = typeof before === 'function' ? functionToExpresion(before, params as string[]) : {};
        const queryLet = typeof query === 'function' ? functionToExpresion(query, params as string[]) : {};
        const afterLet = typeof after === 'function' ? functionToExpresion(after, params as string[]) : {};

        const composition = [];

        composition.push(
          extend({
            data: {},
            ref: {},
            ...inputs,
            _inputs: inputs,
          }),
        );

        composition.push(
          extend([
            {
              ctx: context(ctx || (self.context as any)),
            },
            {
              ctx: {
                identity: q.Select('identity', q.Var('ctx'), null),
                session: q.Select('session', q.Var('ctx'), null),
                callstack: q.If(
                  q.IsString(methodPath),
                  q.Union(q.Select('callstack', q.Var('ctx'), []), [[methodPath]]), // #bug q.Format('%@', params)
                  q.Select('callstack', q.Var('ctx'), []),
                ),
                actions: q.Select('actions', q.Var('ctx'), []),
                errors: q.Select('errors', q.Var('ctx'), []),
                success: q.Select('success', q.Var('ctx'), true),
              },
            },
          ]),
        );

        if (Object.keys(beforeLet).length > 0) {
          composition.push(extend(beforeLet));
        }

        if (definition.annotate) {
          composition.push(
            extend({
              annotationName: definition.name,
              annotationData: q.Var('data'),
              annotationOutput: q.Var('data'),
            }),
          );
        }

        composition.push(extend({ response: queryLet }));

        if (definition.action) {
          composition.push(
            extend({
              actionName: definition.name,
              actionUser: self.identity(q.Var('ctx')),
              actionRef: q.Var('ref'),
            }),
          );
        }

        if (Object.keys(afterLet).length > 0) {
          composition.push(extend(afterLet));
        }

        const expression = compose(...composition)({
          response: q.Var('response'),
          success: q.Select('success', q.Var('ctx'), true),
          actions: q.Select('actions', q.Var('ctx'), []),
          errors: q.Select('errors', q.Var('ctx'), []),
          ts: q.Now(),
        });

        return expression;
      },
      copy(definitionPart) {
        return { ...definition, ...definitionPart };
      },
      udf() {},
      call() {},
    };

    return api;
  }
}
