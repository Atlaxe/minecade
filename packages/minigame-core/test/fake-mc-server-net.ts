// Minimal fake of @minecraft/server-net for unit tests, swapped in by vitest.config.ts. Tests
// answer requests through setHttpHandler(), or send them over real HTTP with bridgeToFetch().

export const HttpRequestMethod = {
  Delete: "Delete",
  Get: "Get",
  Head: "Head",
  Patch: "Patch",
  Post: "Post",
  Put: "Put",
} as const;
export type HttpRequestMethod = (typeof HttpRequestMethod)[keyof typeof HttpRequestMethod];

export class HttpHeader {
  key: string;
  value: string;

  constructor(key: string, value: string) {
    this.key = key;
    this.value = value;
  }
}

export class HttpRequest {
  uri: string;
  method: HttpRequestMethod = HttpRequestMethod.Get;
  body = "";
  headers: HttpHeader[] = [];
  timeout = 10;

  constructor(uri: string) {
    this.uri = uri;
  }
}

export interface FakeHttpResponse {
  status: number;
  body: string;
}

export type FakeHttpHandler = (request: HttpRequest) => FakeHttpResponse | Promise<FakeHttpResponse>;

const noHandler: FakeHttpHandler = (request) => {
  throw new Error(`no fake HTTP handler for ${request.uri}`);
};

let handler = noHandler;

/** Every request made since the last resetHttp(), oldest first. */
export const sentRequests: HttpRequest[] = [];

export function setHttpHandler(next: FakeHttpHandler): void {
  handler = next;
}

/** Sends requests over real HTTP, for tests against a real orchestrator server. */
export function bridgeToFetch(): void {
  setHttpHandler(async (request) => {
    const hasBody = request.method !== HttpRequestMethod.Get && request.method !== HttpRequestMethod.Head;
    const response = await fetch(request.uri, {
      method: request.method.toUpperCase(),
      body: hasBody ? request.body : undefined,
      headers: Object.fromEntries(request.headers.map((header) => [header.key, header.value])),
      signal: AbortSignal.timeout(request.timeout * 1000),
    });
    return { status: response.status, body: await response.text() };
  });
}

export function resetHttp(): void {
  sentRequests.length = 0;
  handler = noHandler;
}

export const http = {
  async request(request: HttpRequest) {
    sentRequests.push(request);
    const response = await handler(request);
    return { ...response, headers: [] as HttpHeader[], request };
  },
  get(uri: string) {
    return http.request(new HttpRequest(uri));
  },
  cancelAll(_reason: string): void {},
};
