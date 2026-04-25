import { describe, expect, it } from "vitest";

import { extractCumulativeUsage } from "../src/lib/anthropicUsage";

describe("extractCumulativeUsage", () => {
  it("returns all four totals from a fully populated usage object", () => {
    const result = extractCumulativeUsage({
      input_tokens: 12345,
      output_tokens: 4567,
      cache_read_input_tokens: 3210,
      cache_creation: {
        ephemeral_5m_input_tokens: 8000,
        ephemeral_1h_input_tokens: 910,
      },
    });
    expect(result).toEqual({
      input: 12345,
      output: 4567,
      cacheRead: 3210,
      cacheCreation: 8910,
    });
  });

  it("uses ephemeral_5m alone when ephemeral_1h is absent", () => {
    const result = extractCumulativeUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 200,
      },
    });
    expect(result.cacheCreation).toBe(200);
    expect(result.cacheRead).toBe(0); // 0 is meaningful — preserve, don't null
  });

  it("sums both ephemeral buckets when both are present", () => {
    const result = extractCumulativeUsage({
      input_tokens: 1,
      output_tokens: 1,
      cache_creation: {
        ephemeral_5m_input_tokens: 100,
        ephemeral_1h_input_tokens: 250,
      },
    });
    expect(result.cacheCreation).toBe(350);
  });

  it("returns nulls for every field when usage is undefined", () => {
    const result = extractCumulativeUsage(undefined);
    expect(result).toEqual({
      input: null,
      output: null,
      cacheCreation: null,
      cacheRead: null,
    });
  });

  it("returns null for cacheCreation when the sub-object is missing", () => {
    const result = extractCumulativeUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      // cache_creation omitted entirely
    });
    expect(result.cacheCreation).toBeNull();
    expect(result.input).toBe(10);
  });
});
