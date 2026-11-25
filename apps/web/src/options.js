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

/** what kind of video the script is written for — the video is then made to match it */
export const FORMAT_KEYS = ["voiceover", "presenter", "drama", "montage"];
export const FORMAT_ICON = { voiceover: "mic", presenter: "user", drama: "film", montage: "sparkles" };
/** the clip look that suits each format (picked for the user, they can still change it) */
export const FORMAT_STYLE = { voiceover: "product", presenter: "presenter", drama: "in_action", montage: "hero" };
export const formatName = (k) => t(`format.${k}`);
export const formatDesc = (k) => t(`format.${k}.desc`);
