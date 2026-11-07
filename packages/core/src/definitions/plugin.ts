import {
  type IdentifierNode,
  type Kysely,
  type KyselyPlugin,
  OperationNodeTransformer,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryId,
  type QueryResult,
  type RootOperationNode,
  type UnknownRow,
} from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { ValueColumns } from "../values/values";
import type { DefinitionTables } from "./tables";

// ---------------------------------------------------------------------------
// Generic tables

/**
 * The definition tables under generic names. Queries here are written against
 * it, and `RenamePlugin` rewrites them to a descriptor's real tables and columns
 * on the way out, and the columns back on the way in. Only the columns this
 * module uses are declared.
 */
export interface DefinitionDB {
  def_types: { id: string; updated_at: number };
  def_fields: {
    id: string;
    def_type_id: string;
    name: string;
    position: number;
    value_type: string;
    required: number;
    constraints: string;
    option_labels: string;
    created_at: number;
    updated_at: number;
  };
  def_records: { id: string; def_type_id: string; updated_at: number };
  def_values: ValueColumns & {
    id: string;
    def_record_id: string;
    field_id: string;
    written_by: string;
    written_at: number;
  };
}

// One builder per seam and descriptor, as `queryBuilder` keeps one per seam.
const builders = new WeakMap<Database, Map<DefinitionTables, Kysely<DefinitionDB>>>();

export function definitionQuery(db: Database, tables: DefinitionTables): Kysely<DefinitionDB> {
  let byTables = builders.get(db);
  if (byTables === undefined) {
    byTables = new Map();
    builders.set(db, byTables);
  }
  let q = byTables.get(tables);
  if (q === undefined) {
    const plugin = new RenamePlugin({
      def_types: tables.types,
      def_fields: tables.fields,
      def_records: tables.records,
      def_values: tables.values,
      def_type_id: tables.typeIdColumn,
      def_record_id: tables.recordIdColumn,
    });
    // The one cast: the plugin makes the generic names real.
    q = queryBuilder(db).withPlugin(plugin) as unknown as Kysely<DefinitionDB>;
    byTables.set(tables, q);
  }
  return q;
}

/** Rewrites generic identifiers to real ones in queries, and real column names back in rows. */
class RenamePlugin implements KyselyPlugin {
  readonly #transformer: RenameTransformer;
  readonly #back: Map<string, string>;

  constructor(names: Record<string, string>) {
    this.#transformer = new RenameTransformer(new Map(Object.entries(names)));
    this.#back = new Map(Object.entries(names).map(([generic, real]) => [real, generic]));
  }

  transformQuery({ node, queryId }: PluginTransformQueryArgs): RootOperationNode {
    return this.#transformer.transformNode(node, queryId);
  }

  async transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const rows = result.rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, v]) => [this.#back.get(key) ?? key, v])),
    );
    return { ...result, rows };
  }
}

class RenameTransformer extends OperationNodeTransformer {
  readonly #names: Map<string, string>;

  constructor(names: Map<string, string>) {
    super();
    this.#names = names;
  }

  protected override transformIdentifier(node: IdentifierNode, queryId?: QueryId): IdentifierNode {
    const transformed = super.transformIdentifier(node, queryId);
    const name = this.#names.get(transformed.name);
    return name === undefined ? transformed : { ...transformed, name };
  }
}
