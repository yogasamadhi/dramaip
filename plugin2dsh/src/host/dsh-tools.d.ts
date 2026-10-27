/**
 * The slice of @deepseek-ai/dsh-tools this plugin uses. The package is a
 * peer supplied by the DSH install at run time; the published npm copies are
 * older than 0.2.1-rc.3, so the types are declared here instead of installed.
 */
declare module '@deepseek-ai/dsh-tools' {
  export interface ParameterSpec {
    readonly type: 'string' | 'number' | 'boolean'
    readonly required?: boolean
    readonly description?: string
  }

  /** Requiredness is a per-property `required: true`, never a `required` list. */
  export type ValueSchemaSpec =
    | {
        readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'null'
        readonly description?: string
      }
    | { readonly type: 'array'; readonly items?: ValueSchemaSpec }
    | {
        readonly type: 'object'
        readonly properties?: Readonly<
          Record<string, ValueSchemaSpec & { readonly required?: boolean }>
        >
        readonly additionalProperties: boolean
      }

  type Infer<P extends Readonly<Record<string, ParameterSpec>>> = {
    [K in keyof P as P[K]['required'] extends true ? K : never]: ParamValue<P[K]>
  } & {
    [K in keyof P as P[K]['required'] extends true ? never : K]?: ParamValue<P[K]>
  }

  type ParamValue<S extends ParameterSpec> = S['type'] extends 'string'
    ? string
    : S['type'] extends 'number'
      ? number
      : boolean

  export interface ToolExecution {
    readonly callId: string
    readonly name: string
    readonly signal: AbortSignal
    readonly agent?: { readonly id: string }
  }

  export type TextBlock = { readonly type: 'text'; readonly text: string }

  export interface ToolSpec<P extends Readonly<Record<string, ParameterSpec>>, V> {
    readonly name: string
    readonly description: string
    readonly parameters: P
    readonly output: {
      readonly schema: ValueSchemaSpec
      readonly render: (args: Infer<P>, value: V) => TextBlock[]
    }
    execute(args: Infer<P>, exec: ToolExecution): Promise<V>
  }

  /** An opaque registration handed to `ctx.tools.register`. */
  export interface ToolDefinition {
    readonly name: string
  }

  export function defineTool<const P extends Readonly<Record<string, ParameterSpec>>, V>(
    spec: ToolSpec<P, V>,
  ): ToolDefinition
}
