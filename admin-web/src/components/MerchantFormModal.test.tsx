import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MerchantFormModal } from "./MerchantFormModal";

const mockGetNgBanks = vi.fn();
const mockResolveBankAccount = vi.fn();

vi.mock("../api", () => ({
  getNgBanks: (...args: unknown[]) => mockGetNgBanks(...args),
  resolveBankAccount: (...args: unknown[]) => mockResolveBankAccount(...args),
}));

describe("MerchantFormModal", () => {
  beforeEach(() => {
    mockGetNgBanks.mockReset();
    mockResolveBankAccount.mockReset();
    mockGetNgBanks.mockResolvedValue([
      { name: "Wema Bank", code: "035", countryCode: "NG" },
      { name: "Access Bank", code: "044", countryCode: "NG" },
    ]);
  });

  it("blocks merchant creation until the bank account has been resolved", async () => {
    render(
      <MerchantFormModal
        open
        mode="create"
        merchant={null}
        error={null}
        isBusy={false}
        onAuthFailure={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockGetNgBanks).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "merchant@getoneto.com" },
    });
    fireEvent.change(screen.getByLabelText("Business name"), {
      target: { value: "Campus Cafe" },
    });
    fireEvent.change(screen.getByLabelText("Cashout bank"), {
      target: { value: "035" },
    });
    fireEvent.change(screen.getByLabelText("Cashout account number"), {
      target: { value: "1234567890" },
    });

    expect(
      screen.getByRole("button", { name: "Create merchant" }),
    ).toBeDisabled();
    expect(screen.getByText("Resolve this account before saving the merchant.")).toBeInTheDocument();
  }, 10000);

  it("uses the resolved account name instead of manual free text on submit", async () => {
    const onSubmit = vi.fn();
    mockResolveBankAccount.mockResolvedValue({
      account: {
        accountName: "Campus Cafe Ltd",
        accountNumber: "1234567890",
        bankCode: "035",
        bankName: "Wema Bank",
      },
    });

    render(
      <MerchantFormModal
        open
        mode="create"
        merchant={null}
        error={null}
        isBusy={false}
        onAuthFailure={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(mockGetNgBanks).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "merchant@getoneto.com" },
    });
    fireEvent.change(screen.getByLabelText("Business name"), {
      target: { value: "Campus Cafe" },
    });
    fireEvent.change(screen.getByLabelText("Cashout bank"), {
      target: { value: "035" },
    });
    fireEvent.change(screen.getByLabelText("Cashout account number"), {
      target: { value: "1234567890" },
    });
    fireEvent.change(screen.getByLabelText("Cashout account name"), {
      target: { value: "Manual Name" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Resolve account" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Cashout account name")).toHaveValue("Campus Cafe Ltd"),
    );
    expect(screen.getByLabelText("Cashout account name")).toHaveAttribute("readonly");

    await userEvent.click(screen.getByRole("button", { name: "Create merchant" }));

    expect(mockResolveBankAccount).toHaveBeenCalledWith(
      {
        bankCode: "035",
        accountNumber: "1234567890",
      },
      expect.any(Function),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      email: "merchant@getoneto.com",
      businessName: "Campus Cafe",
      businessAddress: "",
      cashoutBankName: "Wema Bank",
      cashoutBankCode: "035",
      cashoutAccountNumber: "1234567890",
      cashoutAccountName: "Campus Cafe Ltd",
    });
  }, 10000);

  it("shows an inline Korapay bank load error without triggering auth failure", async () => {
    const onAuthFailure = vi.fn();
    mockGetNgBanks.mockRejectedValue(new Error("korapay_bank_list_unavailable"));

    render(
      <MerchantFormModal
        open
        mode="create"
        merchant={null}
        error={null}
        isBusy={false}
        onAuthFailure={onAuthFailure}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Could not load Korapay banks. Check Korapay API configuration."),
    ).toBeInTheDocument();
    expect(onAuthFailure).not.toHaveBeenCalled();
  }, 10000);

  it("shows an inline error when Korapay bank resolution is unavailable", async () => {
    mockResolveBankAccount.mockRejectedValue(
      new Error("korapay_bank_resolution_unavailable"),
    );

    render(
      <MerchantFormModal
        open
        mode="create"
        merchant={null}
        error={null}
        isBusy={false}
        onAuthFailure={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockGetNgBanks).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "merchant@getoneto.com" },
    });
    fireEvent.change(screen.getByLabelText("Business name"), {
      target: { value: "Campus Cafe" },
    });
    fireEvent.change(screen.getByLabelText("Cashout bank"), {
      target: { value: "035" },
    });
    fireEvent.change(screen.getByLabelText("Cashout account number"), {
      target: { value: "1234567890" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Resolve account" }));

    expect(
      await screen.findByText(
        "Could not resolve the bank account right now. Check Korapay API configuration.",
      ),
    ).toBeInTheDocument();
  }, 10000);
});
