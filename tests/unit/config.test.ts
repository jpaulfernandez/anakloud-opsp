import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_MODEL_ALIAS_PATTERN,
  APP_ENV_VAR,
  CONFIG_ENV_NAMES,
  aiApiKey,
  effectiveAiLevel,
  isModelAlias,
  loadConfig,
  resolveAiLevelPin,
  resolveAppEnvironment,
} from "../../lib/config";
import type { AppEnvironment, ResolvedLevel } from "../../lib/config";

const KEY = "GEMINI_API_KEY";
const LEGACY_KEY = "ANTHROPIC_API_KEY";

function remember(key: string): () => void {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const value = process.env[key];
  return () => {
    if (had) process.env[key] = value;
    else delete process.env[key];
  };
}

function setEnv(name: string): (value: string) => void {
  // NODE_ENV is typed read-only on process.env, so write through a plain
  // record rather than assigning process.env.NODE_ENV directly.
  const env = process.env as Record<string, string | undefined>;
  return (value: string) => {
    env[name] = value;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadConfig", () => {
  it("reads exactly the six boot-time variables", () => {
    const config = loadConfig();
    expect(Object.keys(config.values).sort()).toEqual(
      [...CONFIG_ENV_NAMES].sort(),
    );
  });

  it("does not treat the environment override as a boot-time config value", () => {
    // APP_ENV is used to name the deployment, not as one of the six bootstrap
    // variables, so it must not appear inside `values`.
    const restore = remember(APP_ENV_VAR);
    process.env[APP_ENV_VAR] = "preview";
    try {
      expect(Object.keys(loadConfig().values)).not.toContain(APP_ENV_VAR);
    } finally {
      restore();
    }
  });
});

describe("boot with GEMINI_API_KEY unset", () => {
  it("logs nothing at error, warn or info level, and only reports at debug", () => {
    const restoreKey = remember(KEY);
    delete process.env[KEY];

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    try {
      loadConfig();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
    } finally {
      restoreKey();
    }
  });

  it("returns the resolved key value when set without logging a warning", () => {
    const restoreKey = remember(KEY);
    process.env[KEY] = "dummy-key";

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const config = loadConfig();
      expect(config.values.GEMINI_API_KEY).toBe("dummy-key");
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      restoreKey();
    }
  });
});

describe("AI credential selection (F16-T03)", () => {
  it("selects GEMINI_API_KEY when both it and the legacy key are set", () => {
    const restoreGem = remember(KEY);
    const restoreLegacy = remember(LEGACY_KEY);
    process.env[KEY] = "sk-gemini-active-secret";
    process.env[LEGACY_KEY] = "sk-anthropic-stale-secret";
    try {
      expect(aiApiKey()).toBe("sk-gemini-active-secret");
    } finally {
      restoreGem();
      restoreLegacy();
    }
  });

  it("does not silently fall back to the legacy key when only it is set", () => {
    const restoreGem = remember(KEY);
    const restoreLegacy = remember(LEGACY_KEY);
    delete process.env[KEY];
    process.env[LEGACY_KEY] = "sk-anthropic-stale-secret";
    try {
      expect(aiApiKey()).toBe("");
    } finally {
      restoreGem();
      restoreLegacy();
    }
  });

  it("returns the empty string when no AI key is set", () => {
    const restoreGem = remember(KEY);
    const restoreLegacy = remember(LEGACY_KEY);
    delete process.env[KEY];
    delete process.env[LEGACY_KEY];
    try {
      expect(aiApiKey()).toBe("");
    } finally {
      restoreGem();
      restoreLegacy();
    }
  });
});

describe("resolveAppEnvironment", () => {
  it("uses an explicit override for each named environment", () => {
    for (const env of ["local", "preview", "production"] as AppEnvironment[]) {
      expect(resolveAppEnvironment(env, "development")).toBe(env);
      expect(resolveAppEnvironment(env, "production")).toBe(env);
    }
  });

  it("falls back to local under NODE_ENV=development with no override", () => {
    expect(resolveAppEnvironment(undefined, "development")).toBe("local");
  });

  it("falls back to production under NODE_ENV=production with no override", () => {
    expect(resolveAppEnvironment(undefined, "production")).toBe("production");
  });
});

describe("resolveAiLevelPin", () => {
  it("defaults local and preview to L2", () => {
    expect(resolveAiLevelPin("local", undefined)).toBe("L2");
    expect(resolveAiLevelPin("preview", undefined)).toBe("L2");
  });

  it("defaults production to automatic selection", () => {
    expect(resolveAiLevelPin("production", undefined)).toBe("auto");
  });

  it("lets an explicit pin override the environment default", () => {
    expect(resolveAiLevelPin("local", "L3")).toBe("L3");
    expect(resolveAiLevelPin("preview", "L0")).toBe("L0");
    expect(resolveAiLevelPin("production", "L3")).toBe("L3");
  });

  it("rejects an invalid explicit pin loudly", () => {
    expect(() => resolveAiLevelPin("local", "L9")).toThrow(/AI_LEVEL_PIN/);
  });
});

describe("AI_MODEL alias rejection", () => {
  it("classifies every built-in alias token as an alias", () => {
    for (const m of ["latest", "fastest", "cheapest", "best", "default"]) {
      expect(isModelAlias(m)).toBe(true);
    }
  });

  it("does not flag a genuine pinned model id", () => {
    expect(isModelAlias("claude-4-5-sonnet-20250912")).toBe(false);
    expect(isModelAlias("gpt-5-20251001")).toBe(false);
  });

  it("rejects a Gemini id ending in a moving suffix (F16-T01)", () => {
    expect(isModelAlias("gemini-flash-latest")).toBe(true);
    expect(isModelAlias("gemini-2.5-flash-latest")).toBe(true);
    expect(isModelAlias("gemini-2.5-pro-preview")).toBe(true);
    expect(isModelAlias("gemini-2.5-flash-stable")).toBe(true);
    expect(isModelAlias("gemini-2.5-pro-daily")).toBe(true);
  });

  it("rejects a bare Gemini family name that carries no version (F16-T01)", () => {
    expect(isModelAlias("gemini-flash")).toBe(true);
    expect(isModelAlias("gemini-2.5-flash")).toBe(true);
    expect(isModelAlias("gemini-2.5-pro")).toBe(true);
  });

  it("accepts a pinned dated or numbered Gemini identifier (F16-T01)", () => {
    expect(isModelAlias("gemini-2.5-flash-001")).toBe(false);
    expect(isModelAlias("gemini-1.5-flash-8b-20250827")).toBe(false);
    expect(isModelAlias("gemini-3.7-flash")).toBe(false);
    expect(isModelAlias("models/gemini-3.7-flash")).toBe(false);
  });

  it("loadConfig throws when AI_MODEL matches a known alias pattern", () => {
    const restore = remember("AI_MODEL");
    process.env.AI_MODEL = "latest";
    try {
      expect(() => loadConfig()).toThrow(/AI_MODEL/);
    } finally {
      restore();
    }
  });

  it("loadConfig accepts a pinned model id", () => {
    const restore = remember("AI_MODEL");
    process.env.AI_MODEL = "claude-4-5-sonnet-20250912";
    try {
      expect(loadConfig().values.AI_MODEL).toBe(
        "claude-4-5-sonnet-20250912",
      );
    } finally {
      restore();
    }
  });

  it("loadConfig throws for a moving Gemini suffix at boot (F16-T01)", () => {
    const restore = remember("AI_MODEL");
    process.env.AI_MODEL = "gemini-2.5-flash-latest";
    try {
      expect(() => loadConfig()).toThrow(/AI_MODEL/);
    } finally {
      restore();
    }
  });

  it("loadConfig throws for a bare Gemini family at boot (F16-T01)", () => {
    const restore = remember("AI_MODEL");
    process.env.AI_MODEL = "gemini-2.5-flash";
    try {
      expect(() => loadConfig()).toThrow(/AI_MODEL/);
    } finally {
      restore();
    }
  });

  it("loadConfig accepts a pinned Gemini identifier at boot (F16-T01)", () => {
    const restore = remember("AI_MODEL");
    process.env.AI_MODEL = "gemini-2.5-flash-001";
    try {
      expect(loadConfig().values.AI_MODEL).toBe("gemini-2.5-flash-001");
    } finally {
      restore();
    }
  });

  it("the alias pattern is documented as the known set", () => {
    // Guards the pattern against accidental deletion: if it ever stops
    // matching the alias tokens, tests above will fail, but this also makes
    // the intent explicit.
    expect(AI_MODEL_ALIAS_PATTERN instanceof RegExp).toBe(true);
  });
});

describe("effectiveAiLevel", () => {
  it("drops L0 to L2 when no AI_MODEL is configured", () => {
    expect(effectiveAiLevel("L0", undefined)).toBe("L2");
  });

  it("drops L1 to L2 when no AI_MODEL is configured", () => {
    expect(effectiveAiLevel("L1", undefined)).toBe("L2");
  });

  it("keeps L0 and L1 when a model is configured", () => {
    expect(effectiveAiLevel("L0", "claude-4-5-sonnet-20250912")).toBe("L0");
    expect(effectiveAiLevel("L1", "claude-4-5-sonnet-20250912")).toBe("L1");
  });

  it("leaves L2, L3 and auto unchanged regardless of AI_MODEL", () => {
    for (const level of ["L2", "L3", "auto"] as ResolvedLevel[]) {
      expect(effectiveAiLevel(level, undefined)).toBe(level);
      expect(effectiveAiLevel(level, "claude-4-5-sonnet-20250912")).toBe(level);
    }
  });
});

describe("level pinning end to end", () => {
  it("a local developer with a valid key sees L2 by default", () => {
    const restoreKey = remember(KEY);
    const restoreNode = remember("NODE_ENV");
    const restoreLevel = remember("AI_LEVEL_PIN");
    const restoreApp = remember(APP_ENV_VAR);
    process.env[KEY] = "dummy-key";
    setEnv("NODE_ENV")("development");
    delete process.env.AI_LEVEL_PIN;
    delete process.env[APP_ENV_VAR];
    try {
      const config = loadConfig();
      expect(config.env).toBe("local");
      expect(config.aiLevelPin).toBe("L2");
      expect(config.aiLevel).toBe("L2");
    } finally {
      restoreKey();
      restoreNode();
      restoreLevel();
      restoreApp();
    }
  });

  it("an explicit pin in production wins over auto", () => {
    const restoreNode = remember("NODE_ENV");
    const restoreLevel = remember("AI_LEVEL_PIN");
    const restoreApp = remember(APP_ENV_VAR);
    setEnv("NODE_ENV")("production");
    process.env.AI_LEVEL_PIN = "L3";
    delete process.env[APP_ENV_VAR];
    try {
      const config = loadConfig();
      expect(config.env).toBe("production");
      expect(config.aiLevelPin).toBe("L3");
    } finally {
      restoreNode();
      restoreLevel();
      restoreApp();
    }
  });

  it("preview pins to L2 even with a valid key and no explicit pin", () => {
    const restoreKey = remember(KEY);
    const restoreNode = remember("NODE_ENV");
    const restoreApp = remember(APP_ENV_VAR);
    process.env[KEY] = "dummy-key";
    setEnv("NODE_ENV")("production");
    process.env[APP_ENV_VAR] = "preview";
    try {
      const config = loadConfig();
      expect(config.env).toBe("preview");
      expect(config.aiLevelPin).toBe("L2");
    } finally {
      restoreKey();
      restoreNode();
      restoreApp();
    }
  });

  it("production defaults to automatic selection when unpinned", () => {
    const restoreNode = remember("NODE_ENV");
    const restoreLevel = remember("AI_LEVEL_PIN");
    const restoreApp = remember(APP_ENV_VAR);
    setEnv("NODE_ENV")("production");
    delete process.env.AI_LEVEL_PIN;
    delete process.env[APP_ENV_VAR];
    try {
      const config = loadConfig();
      expect(config.aiLevelPin).toBe("auto");
      expect(config.aiLevel).toBe("auto");
    } finally {
      restoreNode();
      restoreLevel();
      restoreApp();
    }
  });
});