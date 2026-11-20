/** The JSON Schema subset FlowMotion uses (draft-07 compatible, so yaml-language-server reads it). */
export interface Schema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: (string | number | boolean)[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  anyOf?: Schema[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
  pattern?: string;
  /** Completion hint: this text is the id of a node/flow/event/element defined elsewhere in the document. */
  'x-ref'?: 'node' | 'flow' | 'event' | 'element';
  /** Map keys are ids defined elsewhere in the document. */
  'x-key-ref'?: NonNullable<Schema['x-ref']>;
  default?: unknown;
  examples?: unknown[];
}
