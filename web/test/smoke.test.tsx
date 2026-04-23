import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

describe("testing-library smoke", () => {
  it("renders a component and queries it via jest-dom matchers", () => {
    render(<div>Hello CrowdPatch</div>);
    expect(screen.getByText("Hello CrowdPatch")).toBeInTheDocument();
  });
});
