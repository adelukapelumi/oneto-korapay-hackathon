import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryRequestsPage } from "./RecoveryRequestsPage";

const mockGetPendingRecoveryRequests = vi.fn();
const mockApproveRecoveryRequest = vi.fn();
const mockRejectRecoveryRequest = vi.fn();
const mockMarkAnonymous = vi.fn();

vi.mock("../api", () => ({
  getPendingRecoveryRequests: (...args: unknown[]) => mockGetPendingRecoveryRequests(...args),
  approveRecoveryRequest: (...args: unknown[]) => mockApproveRecoveryRequest(...args),
  rejectRecoveryRequest: (...args: unknown[]) => mockRejectRecoveryRequest(...args),
}));

vi.mock("../auth", () => ({
  useAuth: () => ({
    markAnonymous: mockMarkAnonymous,
  }),
}));

function buildRequest(overrides: Partial<Parameters<typeof mockGetPendingRecoveryRequests>[0]> = {}) {
  return {
    id: "recovery-1",
    userId: "user-1",
    oldKeyId: "old-key-1",
    requestedNewPublicKey: "ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "PENDING",
    riskType: "LOST_DEVICE",
    reason: "NEW_PHONE",
    userNotes: "Changed devices",
    approximateBalanceKobo: "450050",
    lastMerchantText: "Campus Cafe",
    lastTopupAmountKobo: "12500",
    reviewedByUserId: null,
    reviewedAt: null,
    decisionNotes: null,
    createdAt: "2026-06-10T12:00:00.000Z",
    updatedAt: "2026-06-10T12:00:00.000Z",
    user: {
      id: "user-1",
      email: "student@getoneto.com",
      role: "STUDENT",
      status: "ACTIVE",
      verifiedBalanceKobo: "502500",
    },
    oldKey: {
      id: "old-key-1",
      publicKey: "ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "RESTRICTED",
      validFrom: "2026-01-01T00:00:00.000Z",
      retiredAt: "2026-06-09T10:00:00.000Z",
      verifyUntil: "2026-06-16T10:00:00.000Z",
    },
    ...overrides,
  };
}

describe("RecoveryRequestsPage", () => {
  beforeEach(() => {
    mockGetPendingRecoveryRequests.mockReset();
    mockApproveRecoveryRequest.mockReset();
    mockRejectRecoveryRequest.mockReset();
    mockMarkAnonymous.mockReset();
  });

  it("renders empty state", async () => {
    mockGetPendingRecoveryRequests.mockResolvedValue([]);

    render(<RecoveryRequestsPage />);

    expect(await screen.findByText("No pending recovery requests.")).toBeInTheDocument();
  });

  it("renders a pending recovery request", async () => {
    mockGetPendingRecoveryRequests.mockResolvedValue([buildRequest()]);

    render(<RecoveryRequestsPage />);

    expect(await screen.findByText("student@getoneto.com")).toBeInTheDocument();
    expect(screen.getByText("STUDENT / ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Verified balance: NGN 5,025.00")).toBeInTheDocument();
    expect(screen.getByText("NEW_PHONE / LOST_DEVICE")).toBeInTheDocument();
    expect(screen.getByText("Old key suffix: aaaaaaaa")).toBeInTheDocument();
    expect(screen.getByText("New key suffix: bbbbbbbb")).toBeInTheDocument();
    expect(screen.queryByText(/ed25519:aaaaaaaa/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ed25519:bbbbbbbb/i)).not.toBeInTheDocument();
  });

  it("shows a warning for high-risk requests", async () => {
    mockGetPendingRecoveryRequests.mockResolvedValue([
      buildRequest({
        reason: "STOLEN_PHONE",
        riskType: "COMPROMISED_DEVICE",
      }),
    ]);

    render(<RecoveryRequestsPage />);

    expect(
      await screen.findByText(
        "High-risk recovery. The old device may already be restricted. Approve only after support verification.",
      ),
    ).toBeInTheDocument();
  });

  it("requires decision notes before rejecting", async () => {
    mockGetPendingRecoveryRequests.mockResolvedValue([buildRequest()]);

    render(<RecoveryRequestsPage />);

    await screen.findByText("student@getoneto.com");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

    expect(
      await screen.findByText("Decision notes are required to reject a recovery request."),
    ).toBeInTheDocument();
    expect(mockRejectRecoveryRequest).not.toHaveBeenCalled();
  });

  it("approves a request and reloads", async () => {
    mockGetPendingRecoveryRequests
      .mockResolvedValueOnce([buildRequest()])
      .mockResolvedValueOnce([]);
    mockApproveRecoveryRequest.mockResolvedValue({ status: "APPROVED" });

    render(<RecoveryRequestsPage />);

    await screen.findByText("student@getoneto.com");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.type(screen.getByLabelText("Decision notes (optional)"), "Support verified");
    await userEvent.click(screen.getByRole("button", { name: "Approve request" }));

    await waitFor(() =>
      expect(mockApproveRecoveryRequest).toHaveBeenCalledWith(
        "recovery-1",
        { decisionNotes: "Support verified" },
        mockMarkAnonymous,
      ),
    );
    await waitFor(() => expect(mockGetPendingRecoveryRequests).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No pending recovery requests.")).toBeInTheDocument();
  });

  it("rejects a request and reloads", async () => {
    mockGetPendingRecoveryRequests
      .mockResolvedValueOnce([buildRequest()])
      .mockResolvedValueOnce([]);
    mockRejectRecoveryRequest.mockResolvedValue({ status: "REJECTED" });

    render(<RecoveryRequestsPage />);

    await screen.findByText("student@getoneto.com");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await userEvent.type(
      screen.getByLabelText("Decision notes (required)"),
      "Identity mismatch during support review",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

    await waitFor(() =>
      expect(mockRejectRecoveryRequest).toHaveBeenCalledWith(
        "recovery-1",
        { decisionNotes: "Identity mismatch during support review" },
        mockMarkAnonymous,
      ),
    );
    await waitFor(() => expect(mockGetPendingRecoveryRequests).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No pending recovery requests.")).toBeInTheDocument();
  });
});
