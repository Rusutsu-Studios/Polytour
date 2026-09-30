type IconName =
  | "dice"
  | "arrow"
  | "copy"
  | "people"
  | "flag"
  | "trophy"
  | "check"
  | "close"
  | "help";
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
  close: "m6 6 12 12M18 6 6 18",
  help: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
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
