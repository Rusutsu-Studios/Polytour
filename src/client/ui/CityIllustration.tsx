import type { BuildLevel } from "../../shared/board/types.js";

function IsoBuilding({
  x,
  y,
  scale = 1,
  color,
  tower = false,
  landmark = false,
}: {
  x: number;
  y: number;
  scale?: number;
  color: string;
  tower?: boolean;
  landmark?: boolean;
}) {
  const height = tower ? 78 : 42;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <polygon
        points={`0,40 42,64 42,${64 + height} 0,${40 + height}`}
        fill="#fffaf0"
      />
      <polygon
        points={`42,64 84,40 84,${40 + height} 42,${64 + height}`}
        fill="#d6dfd4"
      />
      {tower ? (
        <>
          <polygon points="-4,39 42,12 88,39 42,66" fill={color} />
          <polygon
            points="42,66 88,39 88,45 42,72"
            fill="#173b45"
            opacity=".17"
          />
          <polygon
            points="12,37 42,20 73,37 42,55"
            fill="#fffaf0"
            opacity=".38"
          />
        </>
      ) : (
        <>
          <polygon points="-6,41 36,1 91,31 45,70" fill={color} />
          <polygon
            points="45,70 91,31 88,44 45,78"
            fill="#173b45"
            opacity=".2"
          />
          <polygon
            points="-6,41 36,1 36,12 0,47"
            fill="#fffaf0"
            opacity=".15"
          />
        </>
      )}
      {(tower ? [0, 1, 2] : [0]).map((row) => (
        <g key={row} transform={`translate(0 ${row * 18})`}>
          <polygon points="8,55 18,61 18,71 8,65" fill="#2f8296" />
          <polygon points="26,65 36,71 36,81 26,75" fill="#2f8296" />
          <polygon points="51,72 62,66 62,76 51,82" fill="#285d6c" />
          <polygon points="69,61 79,55 79,65 69,71" fill="#285d6c" />
        </g>
      ))}
      <polygon
        points={`27,${47 + height} 37,${53 + height} 37,${64 + height} 27,${58 + height}`}
        fill="#225567"
      />
      <polygon
        points={`-3,${40 + height} 42,${66 + height} 87,${40 + height} 87,${47 + height} 42,${74 + height} -3,${47 + height}`}
        fill="#c4cfb9"
      />
      {landmark && (
        <>
          <polygon points="30,25 42,-34 56,26 43,36" fill="#ffcb55" />
          <polygon points="42,-34 56,26 43,36" fill="#cf9227" />
          <path d="M42-35v-17" stroke="#173b45" strokeWidth="2" />
          <path d="M43-52h17l-4 5 4 5H43" fill={color} />
        </>
      )}
    </g>
  );
}

// Original vector toy geometry, matching the game’s isometric board materials.
// Shared by the buy/build popup and the board inspection card.
export default function CityIllustration({
  level,
  color,
  resort = false,
  flag = false,
}: {
  level: BuildLevel;
  color: string;
  resort?: boolean;
  /** An owned or chosen lot flies a flag in the player's color. */
  flag?: boolean;
}) {
  return (
    <svg
      className="city-art"
      viewBox="0 0 340 245"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        cx="171"
        cy="211"
        rx="137"
        ry="17"
        fill="#173b45"
        opacity=".10"
      />
      <polygon points="24,145 170,75 316,145 170,222" fill="#d2d8bd" />
      <polygon points="24,145 170,213 170,228 24,160" fill="#b8c497" />
      <polygon points="170,213 316,145 316,160 170,228" fill="#91a475" />
      <polygon
        points="32,144 170,82 308,144 170,208"
        fill={resort ? "#a3decc" : "#b5cd70"}
      />
      <path
        d="m74 143 98 46 97-46"
        stroke="#eaf0c3"
        strokeWidth="8"
        fill="none"
      />
      <path
        d="m86 125 86 41 75-36"
        stroke="#eaf0c3"
        strokeWidth="5"
        fill="none"
      />
      {resort ? (
        <>
          <ellipse cx="190" cy="168" rx="45" ry="18" fill="#63bdcf" />
          <ellipse cx="188" cy="166" rx="35" ry="12" fill="#9fe2e2" />
          <IsoBuilding x={86} y={83} scale={0.7} color={color} />
          <path d="M232 153v-46" stroke="#a48048" strokeWidth="5" />
          <path d="m231 108-35-14 26-2 7-29 13 27 27 3-36 15" fill="#478b50" />
          <path d="M206 156v-31" stroke="#906430" strokeWidth="3" />
          <path d="m183 130 22-20 24 20Z" fill={color} />
        </>
      ) : level === 0 ? (
        <>
          <polygon points="111,143 169,116 226,143 169,170" fill="#90b64c" />
          <path
            d="m111 143 58-27 57 27-57 27Z"
            fill="none"
            stroke="#f5edcc"
            strokeWidth="3"
            strokeDasharray="6 5"
          />
        </>
      ) : level === 1 ? (
        <IsoBuilding x={126} y={58} color={color} />
      ) : level === 2 ? (
        <>
          <IsoBuilding x={95} y={66} scale={0.83} color={color} />
          <IsoBuilding x={171} y={90} scale={0.73} color={color} />
        </>
      ) : level === 3 ? (
        <>
          <IsoBuilding x={157} y={44} scale={0.7} color={color} />
          <IsoBuilding x={82} y={78} scale={0.7} color={color} />
          <IsoBuilding x={162} y={109} scale={0.7} color={color} />
        </>
      ) : (
        <IsoBuilding
          x={128}
          y={29}
          scale={0.98}
          color={color}
          tower
          landmark={level === 5}
        />
      )}
      <path d="M69 159v-32" stroke="#526c46" strokeWidth="5" />
      <path d="m68 106 17 26-17 9-17-9Z" fill="#64974e" />
      <path d="m68 106 17 26-17 9Z" fill="#4c7d42" />
      <ellipse cx="260" cy="157" rx="13" ry="5" fill="#708c50" />
      <path d="M260 155v-30" stroke="#9a7745" strokeWidth="3" />
      <path d="m260 126-22-8 16-4 5-20 9 19 19 4-26 9" fill="#679b4e" />
      {flag && (
        <g transform="translate(246 179)">
          <path d="M0 0v-38" stroke="#526b50" strokeWidth="2" />
          <path d="M1-38h27l-5 9 5 9H1Z" fill={color} />
        </g>
      )}
    </svg>
  );
}
