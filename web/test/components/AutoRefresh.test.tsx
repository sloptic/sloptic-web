import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import AutoRefresh from "@/app/AutoRefresh";

// The board leans on this to stay live during a run, and a leaked interval on a settled run means
// the server re-renders a whole leaderboard every five seconds for nobody.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("AutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing", () => {
    const { container } = render(<AutoRefresh />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not refresh before the first interval elapses", () => {
    render(<AutoRefresh intervalMs={5000} />);
    vi.advanceTimersByTime(4999);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once per interval", () => {
    render(<AutoRefresh intervalMs={5000} />);
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("honours a custom interval", () => {
    render(<AutoRefresh intervalMs={1000} />);
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("defaults to five seconds", () => {
    render(<AutoRefresh />);
    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when inactive", () => {
    render(<AutoRefresh intervalMs={1000} active={false} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  // A run settles while the page is open, so active flips to false under a mounted component.
  it("stops when active flips to false", () => {
    const { rerender } = render(<AutoRefresh intervalMs={1000} active />);
    vi.advanceTimersByTime(2000);
    expect(refresh).toHaveBeenCalledTimes(2);
    rerender(<AutoRefresh intervalMs={1000} active={false} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("starts when active flips to true", () => {
    const { rerender } = render(<AutoRefresh intervalMs={1000} active={false} />);
    vi.advanceTimersByTime(3000);
    expect(refresh).not.toHaveBeenCalled();
    rerender(<AutoRefresh intervalMs={1000} active />);
    vi.advanceTimersByTime(2000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("clears its interval on unmount", () => {
    const { unmount } = render(<AutoRefresh intervalMs={1000} />);
    vi.advanceTimersByTime(1000);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not stack intervals when the interval prop changes", () => {
    const { rerender } = render(<AutoRefresh intervalMs={1000} />);
    rerender(<AutoRefresh intervalMs={2000} />);
    vi.advanceTimersByTime(2000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
