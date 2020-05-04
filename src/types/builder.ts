import { Expr } from 'faunadb';
import { FaunaObject } from './fauna';

export interface BiotaBuilderOptionsActionOptions {
  collection?: string;
}

export interface BiotaBuilderOptions {
  path?: string;
  annotate?: boolean;
  action?: boolean;
  actionOptions?: BiotaBuilderOptionsActionOptions;
  identity?(ctx: FaunaObject): Expr;
  context?: any;
}

export type BiotaBuilderDefinitionHandler<I = Expr, O = Expr> = (...args: I[]) => O;

export interface BiotaBuilderDefinition<I = Expr, O = Expr> {
  name: string;
  path?: string;
  params?: string[];
  before?: BiotaBuilderDefinitionHandler<I, O>;
  query: BiotaBuilderDefinitionHandler<I, O>;
  after?: BiotaBuilderDefinitionHandler<I, O>;
  role?: string;
  context?(ctx: Expr): O;

  alias?: boolean;
  annotate?: boolean;
  action?: boolean;
}

export interface BiotaBuilderMethodOutputAPI {
  definition(): BiotaBuilderDefinition;
  context(ctx: FaunaObject): BiotaBuilderMethodOutputAPI;
  query(...args: any[]): any;
  copy(definitionPart: BiotaBuilderDefinition): any;
  udf(): void;
  call(...args: any[]): void;
}

export interface BiotaBuilderMethodOutputAPIKeyed {
  [key: string]: BiotaBuilderMethodOutputAPI;
}

export interface BiotaBuilderDefinitionKeyed<O = Expr> {
  [key: string]: BiotaBuilderDefinition<O>;
}
