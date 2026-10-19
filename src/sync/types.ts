/** Values a synced field may hold. Kept primitive so they serialise, compare and validate trivially. */
export type Primitive = string | number | boolean;

/** Shape of a synced document: a flat record of primitive fields. */
export type Fields = Record<string, Primitive>;

/** The string keys of a document type. */
export type FieldKey<T extends Fields> = Extract<keyof T, string>;

export interface FieldSpec<V extends Primitive> {
  /**
   * Value used until the field is explicitly set. It may depend on the environment
   * (for example the operating system's colour scheme), so it is re-evaluated on demand.
   */
  readonly defaultValue: () => V;
  /** Runtime guard for values arriving from storage or from other tabs, which are untrusted. */
  readonly isValid: (value: unknown) => value is V;
}

/** Describes every field of a synced document. */
export type Schema<T extends Fields> = { readonly [K in FieldKey<T>]: FieldSpec<T[K]> };

export function fieldKeys<T extends Fields>(schema: Schema<T>): FieldKey<T>[] {
  return Object.keys(schema) as FieldKey<T>[];
}
