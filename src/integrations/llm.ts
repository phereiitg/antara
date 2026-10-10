export interface InlineMedia {
  mimeType: string;
  data: Buffer;
}

export interface JsonRequest {
  step: "extraction" | "verification" | "vision" | "transcription";
  prompt: string;
  schema: object;
  media?: InlineMedia[];
}

// Structured-output model used by the deterministic pipeline steps (not the agent).
export interface JsonLlm {
  readonly model: string;
  generateJson(request: JsonRequest): Promise<unknown>;
}
