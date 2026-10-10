import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for the Python STT service (offline tests). Records the last request it received.

export const HINDI = "नमस्ते, यह पानी का नमूना हैंडपंप से लिया गया है।";

export const pythonTranscript = {
  language: "hi-IN", provider: "gnani", text: HINDI,
  segments: [{ text: HINDI, start: null, end: null, clipId: null }],
  timestampsApproximate: false, timestampsAvailable: false, requestId: "r1", model: "gnani-prisma-v2.5",
};

export interface FakeService {
  url: string;
  last?: { url?: string; contentType?: string; body: string };
  close(): Promise<void>;
}

export async function startFakeService(status: number, body: unknown): Promise<FakeService> {
  const svc = { url: "", last: undefined } as unknown as FakeService;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      svc.last = { url: req.url, contentType: req.headers["content-type"], body: Buffer.concat(chunks).toString("utf8") };
      res.writeHead(status, { "content-type": "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  svc.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  svc.close = () => new Promise<void>((done) => server.close(() => done()));
  return svc;
}
