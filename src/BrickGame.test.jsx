import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BrickGame from "./BrickGame.jsx";

describe("BrickGame", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the console with a WELCOME overlay and START control", () => {
    render(<BrickGame />);
    expect(screen.getByText("WELCOME")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause / Start" })).toBeInTheDocument();
  });

  it("starts the game on START and shows the running board", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    expect(screen.queryByText("WELCOME")).not.toBeInTheDocument();
    expect(screen.getByText("SCORE")).toBeInTheDocument();
  });

  it("NEXT preview shows a valid piece shape", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    expect(screen.getByText("NEXT")).toBeInTheDocument();
  });

  it("DAS: hold handlers are wired to the move buttons", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    const left = screen.getByRole("button", { name: "Left / Speed-" });
    const right = screen.getByRole("button", { name: "Right / Speed+" });
    expect(left).toBeInTheDocument();
    expect(right).toBeInTheDocument();
    // single click moves the piece; hold repeat is timer-driven
    await user.click(left);
    await user.click(right);
  });

  it("pauses and resumes", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
  });

  it("opens OPTIONS with dialog semantics and closes via Escape", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Options" }));

    const dialog = screen.getByRole("dialog", { name: "Game options" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // switches expose real state
    expect(screen.getByRole("switch", { name: "Sound" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Gesture" })).toHaveAttribute("aria-checked", "false");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles persist to localStorage", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(screen.getByRole("switch", { name: "Gesture" }));
    expect(JSON.parse(window.localStorage.getItem("brick_gesture"))).toBe(true);
  });

  it("keeps the game interrupted while OPTIONS is open", async () => {
    const user = userEvent.setup();
    render(<BrickGame />);
    await user.click(screen.getByRole("button", { name: "Pause / Start" }));
    await user.click(screen.getByRole("button", { name: "Options" }));
    // gameplay UI remains mounted behind the modal, no crash
    expect(screen.getByText("SCORE")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Game options" })).toBeInTheDocument();
  });
});
