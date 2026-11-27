import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { notFoundImage } from "../assets";

export default function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <s-page>
      <s-section accessibilityLabel={t("NotFound.heading")}>
        <s-empty-state heading={t("NotFound.heading")}>
          <s-box slot="graphic" maxInlineSize="226px">
            <s-image src={notFoundImage} alt="" />
          </s-box>
          <s-text slot="subheading">{t("NotFound.description")}</s-text>
          <s-button slot="primary-action" variant="primary" onClick={() => navigate("/")}>
            {t("NotFound.backToTimers")}
          </s-button>
        </s-empty-state>
      </s-section>
    </s-page>
  );
}
