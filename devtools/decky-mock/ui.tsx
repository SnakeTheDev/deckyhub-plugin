// Minimal visual stand-in for @decky/ui, for local browser preview only.
// The real components are scraped at runtime from Steam's own webpack bundle
// (via findModuleExport), so nothing here is pixel-accurate — this exists to
// exercise layout and logic, not to review visuals.
import React, { createElement, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export function PanelSection({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <section className="steam-panel">
      {title && <h3 className="steam-panel-title">{title}</h3>}
      {children}
    </section>
  );
}

export function PanelSectionRow({ children }: { children?: ReactNode }) {
  return <div className="steam-row">{children}</div>;
}

export function ButtonItem({
  layout,
  onClick,
  disabled,
  children,
}: {
  layout?: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="steam-button"
    >
      {children}
    </button>
  );
}

export function Button({
  onClick,
  disabled,
  children,
  style,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="steam-button" style={style}>
      {children}
    </button>
  );
}

export const DialogButtonPrimary = Button;

export function ModalRoot({ children }: { children?: ReactNode }) {
  return (
    <div className="steam-modal-backdrop">
      <div className="steam-modal">{children}</div>
    </div>
  );
}

export function Dropdown({
  rgOptions,
  selectedOption,
  onChange,
  menuLabel,
}: {
  rgOptions: { label: ReactNode; data: unknown }[];
  selectedOption: unknown;
  onChange?: (option: { data: unknown }) => void;
  menuLabel?: string;
}) {
  return (
    <select
      aria-label={menuLabel}
      value={String(selectedOption)}
      onChange={(event) => {
        const option = rgOptions.find((item) => String(item.data) === event.target.value);
        if (option) onChange?.(option);
      }}
      className="steam-select"
    >
      {rgOptions.map((option) => (
        <option key={String(option.data)} value={String(option.data)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function DropdownItem({
  label,
  rgOptions,
  selectedOption,
  onChange,
  layout,
}: {
  label?: string;
  rgOptions: { label: ReactNode; data: unknown }[];
  selectedOption: unknown;
  onChange: (option: { data: unknown }) => void;
  layout?: "below" | "inline";
}) {
  // Like Steam's Field: "inline" puts the label beside the control instead of above it.
  const inline = layout === "inline";
  return (
    <label className="steam-field-label" style={inline ? { display: "flex", alignItems: "center", gap: 12 } : undefined}>
      {label}
      <select
        style={inline ? { flex: 1, marginTop: 0, width: "auto" } : undefined}
        value={String(selectedOption)}
        onChange={(event) => {
          const option = rgOptions.find((item) => String(item.data) === event.target.value);
          if (option) onChange(option);
        }}
        className="steam-select"
      >
        {rgOptions.map((option) => (
          <option key={String(option.data)} value={String(option.data)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  bIsPassword,
  bShowClearAction,
}: {
  label?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  bIsPassword?: boolean;
  bShowClearAction?: boolean;
}) {
  return (
    <label className="steam-field-label">
      {label}
      <input type={bIsPassword ? "password" : "text"} value={value} onChange={onChange} className="steam-input" />
      {bShowClearAction && value && (
        <button
          type="button"
          aria-label="Clear"
          className="steam-button"
          onClick={() => onChange?.({ currentTarget: { value: "" } } as React.ChangeEvent<HTMLInputElement>)}
        >
          Clear
        </button>
      )}
    </label>
  );
}

export function ToggleField({ label, checked, onChange }: { label?: string; checked?: boolean; onChange?: (checked: boolean) => void }) {
  return (
    <label className="steam-toggle">
      {label}
      <input type="checkbox" checked={checked} onChange={(event) => onChange?.(event.target.checked)} />
    </label>
  );
}

export function Focusable({ style, children, ...rest }: { style?: CSSProperties; children?: ReactNode; [key: string]: unknown }) {
  const { "flow-children": flowChildren, noFocusRing: _noFocusRing, onActivate, onCancel: _onCancel, ...divProps } = rest;
  const flowStyle = flowChildren === "right" ? { display: "flex", flexDirection: "row" as const } : flowChildren === "down" ? { display: "flex", flexDirection: "column" as const } : {};
  return (
    // Like Steam, onActivate makes the block itself a focus stop. The flow is
    // exposed so tests can check D-pad structure the geometric mock ignores.
    <div data-focusable="" data-flow-children={flowChildren as string | undefined} style={{ ...flowStyle, ...style }} tabIndex={onActivate ? 0 : undefined} {...(divProps as React.HTMLAttributes<HTMLDivElement>)}>
      {children}
    </div>
  );
}

export function Spinner({ style }: { style?: CSSProperties }) {
  const [tick] = useState(() => Math.random().toString(36).slice(2));
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid #3d4450",
        borderTopColor: "#1a9fff",
        borderRadius: "50%",
        animation: `decky-mock-spin-${tick} 0.8s infinite linear`,
        verticalAlign: "middle",
        ...style,
      }}
    >
      <style>{`@keyframes decky-mock-spin-${tick} { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

export function ProgressBar({ indeterminate, nProgress }: { indeterminate?: boolean; nProgress?: number }) {
  const [tick] = useState(() => Math.random().toString(36).slice(2));
  return (
    <div style={{ height: 6, background: "#1a1d23", borderRadius: 3, overflow: "hidden" }}>
      <style>{`@keyframes decky-mock-indeterminate-${tick} { from { margin-left: -40%; } to { margin-left: 100%; } }`}</style>
      <div
        style={{
          height: "100%",
          width: indeterminate ? "40%" : `${nProgress ?? 0}%`,
          background: "#1a9fff",
          animation: indeterminate ? `decky-mock-indeterminate-${tick} 1.2s infinite linear` : undefined,
        }}
      />
    </div>
  );
}

export function ConfirmModal({
  strTitle,
  strDescription,
  strOKButtonText = "OK",
  strCancelButtonText = "Cancel",
  bAlertDialog,
  bDestructiveWarning,
  onOK,
  onCancel,
  closeModal,
  children,
}: {
  strTitle?: ReactNode;
  strDescription?: ReactNode;
  strOKButtonText?: ReactNode;
  strCancelButtonText?: ReactNode;
  bAlertDialog?: boolean;
  bDestructiveWarning?: boolean;
  onOK?: () => void;
  onCancel?: () => void;
  closeModal?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="steam-modal-backdrop">
      <div className="steam-modal">
        <h3 style={{ margin: "0 0 10px" }}>{strTitle}</h3>
        {strDescription && <div style={{ fontSize: 13, marginBottom: 16 }}>{strDescription}</div>}
        {children && <div style={{ marginBottom: 16 }}>{children}</div>}
        <div className="steam-modal-actions">
          {!bAlertDialog && (
            <button
              onClick={() => {
                onCancel?.();
                closeModal?.();
              }}
              className="steam-tab"
            >
              {strCancelButtonText}
            </button>
          )}
          <button
            onClick={() => {
              onOK?.();
              closeModal?.();
            }}
            className="steam-button"
          >
            {strOKButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

let modalHost: HTMLDivElement | null = null;
export function showModal(node: React.ReactElement) {
  if (!modalHost) {
    modalHost = document.createElement("div");
    document.body.appendChild(modalHost);
  }
  const root = createRoot(modalHost);
  const close = () => root.unmount();
  root.render(createElement(node.type, { ...(node.props as object), closeModal: close }));
}

export const Navigation = {
  Navigate: (path: string) => window.dispatchEvent(new CustomEvent("decky-mock-navigate", { detail: path })),
  // ponytail: no history; "back" always lands on the Quick Access widget.
  NavigateBack: () => window.dispatchEvent(new CustomEvent("decky-mock-navigate", { detail: null })),
  NavigateToExternalWeb: (url: string) => window.open(url, "_blank"),
};

export const staticClasses = { Title: "decky-mock-title" };

export function Tabs({
  tabs,
  activeTab,
  onShowTab,
}: {
  tabs: { id: string; title: string; content: ReactNode }[];
  activeTab: string;
  onShowTab: (tab: string) => void;
}) {
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  return (
    <div>
      <div className="steam-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onShowTab(tab.id)}
            className={`steam-tab ${tab.id === active?.id ? "steam-tab-active" : ""}`}
          >
            {tab.title}
          </button>
        ))}
      </div>
      {active?.content}
    </div>
  );
}
