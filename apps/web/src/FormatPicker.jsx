import Icon from "./icons.jsx";
import { t } from "./i18n.js";
import { FORMAT_KEYS, FORMAT_ICON, formatName, formatDesc } from "./options.js";

/** the script / video format as four cards (Voiceover · Talking presenter · Mini drama · Graphic montage) */
export default function FormatPicker({ value, onChange, disabled }) {
  return (
    <div className="field">
      <span className="label">{t("format.label")}</span>
      <div className="format-grid" role="radiogroup" aria-label={t("format.label")}>
        {FORMAT_KEYS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled}
            className={`format-card${value === k ? " on" : ""}`} onClick={() => onChange(k)}>
            <span className="format-icon"><Icon name={FORMAT_ICON[k]} size={20} /></span>
            <span className="format-name">{formatName(k)}</span>
            <span className="format-desc">{formatDesc(k)}</span>
            {value === k && <span className="format-check"><Icon name="check" size={14} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}
