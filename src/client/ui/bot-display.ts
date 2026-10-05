import type { BotDifficulty } from "../../shared/engine/index.js";
import { translate } from "../i18n.js";

export function botDifficultyName(difficulty: BotDifficulty = "medium") {
  switch (difficulty) {
    case "easy":
      return translate("Facile", "Easy");
    case "medium":
      return translate("Moyen", "Medium");
    case "hard":
      return translate("Difficile", "Hard");
  }
}
