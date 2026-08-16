import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_ENV_NAMES, loadConfig } from "../../lib/config";

const KEY = "ANTHROPIC_API_KEY";

function remember(key: string): () => void {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const value = process.env[key];
  return () => {
    if (had) process.env[key] = value;
    else delete process.env[key];
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

  it("returns the environment name", () => {
    expect(loadConfig().env).toBe(process.env.NODE_ENV ?? "development");
  });
});

describe("boot with ANTHROPIC_API_KEY unset", () => {
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
      expect(config.values.ANTHROPIC_API_KEY).toBe("dummy-key");
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      restoreKey();
    }
  });
});