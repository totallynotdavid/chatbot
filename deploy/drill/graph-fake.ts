// A stand-in for graph.facebook.com. It records every send the backend makes
// and lists them at GET /received.
const received: unknown[] = [];
const SEND = /^\/v\d+\.\d+\/[^/]+\/messages$/;

Bun.serve({
  port: 8080,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/health") {
      return new Response("ok");
    }
    if (request.method === "GET" && pathname === "/received") {
      return Response.json(received);
    }
    if (request.method === "POST" && SEND.test(pathname)) {
      received.push({
        path: pathname,
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      });
      return Response.json({
        messages: [{ id: `wamid.FAKE${received.length}` }],
      });
    }

    return new Response("not found", { status: 404 });
  },
});
