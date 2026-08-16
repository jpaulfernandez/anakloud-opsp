import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const allDeps: Record<string, string> = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
};

// Deliberately excluded in tech_infrastructure.md §1: realtime subscriptions,
// a queue, Redis, a vector DB, any drag-and-drop library, and (per the same
// "at n=6 these add failure modes" argument) a state-management library.
const EXCLUDED: Array<{ name: string; kind: string }> = [
  // Realtime subscriptions
  { name: "socket.io", kind: "realtime subscriptions" },
  { name: "socket.io-client", kind: "realtime subscriptions" },
  { name: "pusher-js", kind: "realtime subscriptions" },
  // Queue
  { name: "bull", kind: "queue" },
  { name: "bullmq", kind: "queue" },
  { name: "ioredis", kind: "queue/redis" },
  { name: "amqplib", kind: "queue" },
  // Redis and vector DB
  { name: "redis", kind: "Redis" },
  { name: "pgvector", kind: "vector DB" },
  { name: "pgvector-node", kind: "vector DB" },
  { name: "qdrant-js", kind: "vector DB" },
  { name: "chromadb", kind: "vector DB" },
  { name: "pinecone-client", kind: "vector DB" },
  { name: "weaviate-ts-client", kind: "vector DB" },
  // Drag-and-drop
  { name: "@dnd-kit/core", kind: "drag-and-drop" },
  { name: "@dnd-kit/sortable", kind: "drag-and-drop" },
  { name: "react-beautiful-dnd", kind: "drag-and-drop" },
  { name: "pragmatic-drag-and-drop", kind: "drag-and-drop" },
  // State management
  { name: "redux", kind: "state management" },
  { name: "react-redux", kind: "state management" },
  { name: "zustand", kind: "state management" },
  { name: "mobx", kind: "state management" },
  { name: "jotai", kind: "state management" },
  { name: "recoil", kind: "state management" },
];

describe("dependency tree", () => {
  it.each(EXCLUDED)(
    "is free of $kind ($name)",
    ({ name, kind }) => {
      expect(allDeps[name], `${name} is a ${kind} and SHALL NOT be present`).toBeUndefined();
    },
  );
});

describe("TypeScript strict mode", () => {
  it("compiles every source file with strict: true", () => {
    const tsconfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { strict?: unknown } };
    expect(tsconfig.compilerOptions?.strict).toBe(true);
  });
});