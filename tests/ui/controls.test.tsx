import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox, Switch } from "@/ui/field";
import { Tabs } from "@/ui/misc";

describe("Checkbox", () => {
  it("shows the mixed state as indeterminate", () => {
    render(<Checkbox label="All" checked="mixed" onChange={() => {}} />);
    const box = screen.getByRole<HTMLInputElement>("checkbox", { name: "All" });
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
  });

  it("reports the new value and does not bubble the click to the row", async () => {
    const onChange = vi.fn<(checked: boolean) => void>();
    const onRow = vi.fn<() => void>();
    render(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onRow}>
        <Checkbox label="Pick" checked={false} onChange={onChange} />
      </div>,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Pick" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onRow).not.toHaveBeenCalled();
  });
});

function SwitchHarness() {
  const [on, setOn] = useState(false);
  return <Switch label="Notify" checked={on} onChange={setOn} />;
}

describe("Switch", () => {
  it("toggles aria-checked", async () => {
    render(<SwitchHarness />);
    const toggle = screen.getByRole("switch", { name: "Notify" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Tabs", () => {
  it("marks the active tab and hides zero counts", async () => {
    const onChange = vi.fn<(id: string) => void>();
    render(
      <Tabs
        items={[
          { id: "deps", label: "Dependencies", count: 3 },
          { id: "git", label: "Git", count: 0 },
        ]}
        value="deps"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("tab", { name: /^Dependencies\s*3$/ }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "Git" }));
    expect(onChange).toHaveBeenCalledWith("git");
  });
});
