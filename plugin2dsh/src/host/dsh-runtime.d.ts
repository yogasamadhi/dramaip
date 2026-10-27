// Narrow rc.3 peer facade; verify-temp-home exercises these real runtime APIs.
declare module '@deepseek-ai/dsh-typert-protocol' {
  export abstract class TypertRemoteService {
    protected constructor(
      ctx: import('./context.ts').HostContext,
      serviceKey: string,
      options?: { namespace: string },
    )
  }
  export class RemoteError extends Error {
    constructor(code: string, message: string, details: object)
  }
}
