type IconName =
  | "dice"
  | "arrow"
  | "copy"
  | "people"
  | "flag"
  | "trophy"
  | "check"
  | "close"
  | "minimize"
  | "bank"
  | "help"
  | "journal"
  | "shield"
  | "settings"
  | "search"
  | "exit"
  | "pause"
  | "fullscreen"
  | "graphics"
  | "lock"
  | "pin"
  | "crown"
  | "screen"
  | "bot";
const paths: Record<IconName, string> = {
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  copy: "M9 9h11v12H9V9ZM5 15H3V3h12v2",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 7.75",
  flag: "M5 22V3m0 0c4-4 10 4 15 0v10c-5 4-11-4-15 0",
  trophy:
    "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H3v2a4 4 0 0 0 5 4m8-6h5v2a4 4 0 0 1-5 4M12 13v6m-4 2h8m-6-2h4",
  check: "m5 12 4 4L19 6",
  minimize: "M5 17h14",
  bank: "m3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18M2 18h20",
  close: "m6 6 12 12M18 6 6 18",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  journal: "M4 3h14a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V3Zm0 14h16M8 7h8M8 11h6",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-5 10 3 3 7-7",
  settings: "M4 7h16M4 17h16M9 4v6m6 4v6",
  search: "M21 21l-5-5m-6 2a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z",
  exit: "M9 3H3v18h6m-2-9h14m-5-5 5 5-5 5",
  pause: "M8 5v14M16 5v14",
  fullscreen: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  graphics:
    "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 18h8m-4-4v4",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5V11Zm7 4v2",
  pin: "M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  crown: "M4 18h16M4 7l4 4 4-6 4 6 4-4-1.5 11h-13L4 7Z",
  screen: "M3 4h18v12H3V4Zm5 17h8m-4-5v5",
  bot: "M12 3v4M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm3 5h.01M15 12h.01M9 16h6",
};
export default function Icon({
  name,
  size = 20,
}: {
  name: IconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
