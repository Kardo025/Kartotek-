// React ports of the engine's tabs. A tab whose module exports null is still drawn by the engine view.
import Study from "./Study.jsx";
import Lesson from "./Lesson.jsx";
import Cards from "./Cards.jsx";
import Settings from "./Settings.jsx";
import Stats from "./Stats.jsx";
import Algorithm from "./Algorithm.jsx";
import Cents, { Tud } from "./Cents.jsx";
import Mock from "./Mock.jsx";
import Apply from "./Apply.jsx";
import MindMaps from "./MindMaps.jsx";
import { Career, EuroApply, MockPicker } from "./Planned.jsx";

export const REACT_TABS = { etut: Study, lesson: Lesson, cards: Cards, cents: Cents, tud: Tud, mock: Mock, "tud-apply": Apply, mindmaps: MindMaps, career: Career, euroapply: EuroApply, "mock-all": MockPicker, settings: Settings, stats: Stats, algo: Algorithm };
