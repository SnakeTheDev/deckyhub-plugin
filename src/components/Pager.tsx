import { DialogButtonPrimary as Button, Focusable } from "@decky/ui";
import { FaArrowLeft, FaArrowRight } from "react-icons/fa";
import { useT } from "../i18n";
import { compactButtonStyle } from "../utils";

// Previous / "Page x of y" / Next, with page counted from 0.
export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const t = useT();
  return (
    <Focusable flow-children="right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <Button style={compactButtonStyle} disabled={page === 0} onClick={() => onChange(page - 1)}>
          <FaArrowLeft /> {t("repos.previous")}
        </Button>
      </div>
      <span style={{ whiteSpace: "nowrap" }}>{t("repos.pageOf", { page: page + 1, total })}</span>
      <div style={{ flex: 1 }}>
        <Button style={compactButtonStyle} disabled={page + 1 >= total} onClick={() => onChange(page + 1)}>
          {t("repos.next")} <FaArrowRight />
        </Button>
      </div>
    </Focusable>
  );
}
