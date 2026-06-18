declare module 'node:fs' {
  const fs: any;
  export default fs;
}

declare module 'node:path' {
  const path: any;
  export default path;
}

declare module 'node:http' {
  export interface Server {}
  export interface ServerResponse {}
  export interface IncomingMessage {}
  export function createServer(...args: any[]): Server;
  const _default: {
    createServer(...args: any[]): Server;
    Server: new (...args: any[]) => Server;
    ServerResponse: new (...args: any[]) => ServerResponse;
    IncomingMessage: new (...args: any[]) => IncomingMessage;
  };
  export default _default;
}

interface BufferConstructor {
  from(data: string, encoding?: string): Uint8Array;
}
declare var Buffer: BufferConstructor;

declare var process: {
  argv: string[];
  exit(code?: number): never;
};
