export interface ModelPaths {
  model: string;
  lex: string;
  vocabs: string[];
}

export type EngineRequest =
  | { id: number; type: 'load'; key: string; files: ModelPaths }
  | { id: number; type: 'unload'; key: string }
  | { id: number; type: 'translate'; chain: string[]; texts: string[] }
  | { id: number; type: 'memory' };

export type EngineReply =
  | { id: number; ok: true; texts?: string[]; rss?: number }
  | { id: number; ok: false; error: string };
