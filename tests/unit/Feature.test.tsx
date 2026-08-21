import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMockRoom } from "@baditaflorin/mesh-common/testing";
import { Feature, isChainWord, isValidNextWord, normalizeWord } from "../../src/Feature";
import { config } from "../../src/config";

describe("word chain rules", () => {
  it("normalizes words before sharing them", () => {
    expect(normalizeWord("  Hello   World ")).toBe("hello world");
  });

  it("requires alphabetic words within a practical length", () => {
    expect(isChainWord("word-chain")).toBe(true);
    expect(isChainWord("a")).toBe(false);
    expect(isChainWord("123")).toBe(false);
  });

  it("requires each move to continue the previous final letter", () => {
    const previous = {
      id: "1",
      value: "mesh",
      firstLetter: "m",
      lastLetter: "h",
      authorId: "a",
      createdAt: 1,
    };
    expect(isValidNextWord("harbor", previous)).toBe(true);
    expect(isValidNextWord("river", previous)).toBe(false);
  });
});

describe("Feature", () => {
  it("renders a playable word-chain surface when connected", () => {
    render(<Feature room={createMockRoom()} config={config} />);
    expect(screen.getByRole("heading", { name: "Keep the word moving." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start round" })).toBeInTheDocument();
  });

  it("renders safely while the room is connecting", () => {
    render(<Feature room={null} config={config} />);
    expect(screen.getByText("Connecting to room…")).toBeInTheDocument();
  });
});
