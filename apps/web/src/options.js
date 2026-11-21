// Choices shared by the "Add product" and product pages (labels live in i18n.js)
import { t } from "./i18n.js";

/** how the clip looks */
export const STYLE_KEYS = ["product", "presenter", "unboxing", "hero", "macro", "in_action", "flatlay"];
/** how the AI script sells — the same angle is used for every selected language */
export const ANGLE_KEYS = ["auto", "problem_solution", "review", "unboxing", "soft_sell", "hard_sell", "storytelling"];

export const styleName = (k) => t(`style.${k}`);
export const styleDesc = (k) => t(`style.${k}.desc`);
export const angleName = (k) => t(`angle.${k}`);
export const angleDesc = (k) => t(`angle.${k}.desc`);
