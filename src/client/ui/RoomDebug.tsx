import { useId } from "react";
import type { Seat } from "../../shared/engine/index.js";
import type { RoomDiagnostics } from "../../shared/protocol/room-diagnostics.js";
import { useLocale } from "../i18n.js";
import type { RoomDebugState } from "../net/room-debug.js";

const REGIONS_FR: Readonly<Record<string, string>> = {
  Europe: "Europe",
  Africa: "Afrique",
  Asia: "Asie",
  "Latin America & the Caribbean": "Amérique latine et Caraïbes",
  "Middle East": "Moyen-Orient",
  "North America": "Amérique du Nord",
  Oceania: "Océanie",
};

export function translatedRegion(
  region: string | null,
  t: (fr: string, en: string) => string,
) {
  return region && Object.hasOwn(REGIONS_FR, region)
    ? t(REGIONS_FR[region] ?? region, region)
    : t("Indisponible", "Unavailable");
}

function socketEntry(
  worker: RoomDiagnostics["worker"],
  t: (fr: string, en: string) => string,
) {
  if (worker.runtime === "local") return t("Local", "Local");
  return worker.cloudflare
    ? [worker.cloudflare.colo, worker.cloudflare.location]
        .filter(Boolean)
        .join(" · ")
    : t("Indisponible", "Unavailable");
}

export default function RoomDebug({
  value,
  ownSeat,
}: {
  value: RoomDebugState;
  ownSeat: Seat | null;
}) {
  const { locale, t } = useLocale();
  const id = useId();
  const diagnostics = value.diagnostics;
  const samples = value.samples
    .slice(-60)
    .filter(
      (sample) =>
        Number.isFinite(sample.latencyMs) &&
        sample.latencyMs >= 0 &&
        Number.isFinite(sample.checkedAt),
    );
  const minimum = samples.length
    ? Math.round(Math.min(...samples.map((sample) => sample.latencyMs)))
    : null;
  const maximum = samples.length
    ? Math.round(Math.max(...samples.map((sample) => sample.latencyMs)))
    : null;
  const average = samples.length
    ? Math.round(
        samples.reduce((sum, sample) => sum + sample.latencyMs, 0) /
          samples.length,
      )
    : null;
  const formatMs = (latency: number | null) =>
    latency === null ? "-" : `${Math.round(latency)} ms`;
  const chartSummary = samples.length
    ? t(
        `${samples.length} mesures. Minimum ${minimum} ms, moyenne ${average} ms, maximum ${maximum} ms.`,
        `${samples.length} samples. Minimum ${minimum} ms, average ${average} ms, maximum ${maximum} ms.`,
      )
    : t("Aucune mesure pour le moment.", "No measurements yet.");
  const first = samples[0];
  const last = samples.at(-1);
  const span = Math.max(
    5_000,
    (last?.checkedAt ?? 0) - (first?.checkedAt ?? 0),
  );
  const ceiling = Math.max(20, Math.ceil((maximum ?? 0) / 10) * 10);
  const segments: { key: number; points: string[] }[] = [];
  let previousAt: number | null = null;
  for (const sample of samples) {
    if (previousAt === null || sample.checkedAt - previousAt > 8_000) {
      segments.push({ key: sample.checkedAt, points: [] });
    }
    const x = 42 + ((sample.checkedAt - (first?.checkedAt ?? 0)) / span) * 390;
    const y = 84 - (sample.latencyMs / ceiling) * 68;
    segments.at(-1)?.points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    previousAt = sample.checkedAt;
  }
  const pingState =
    value.pingStatus === "timeout"
      ? t("Délai de réponse dépassé", "Response timed out")
      : value.pingStatus === "measuring"
        ? t("Mesure en cours…", "Measuring…")
        : value.pingStatus === "success"
          ? t("Toutes les 5 s", "Every 5 s")
          : t("En attente de connexion", "Waiting for connection");
  const roomState =
    value.status === "loading"
      ? t("Chargement des informations de la salle…", "Loading room details…")
      : value.status === "unavailable"
        ? t(
            "Informations de la salle indisponibles.",
            "Room details unavailable.",
          )
        : t(
            "En attente de connexion à la salle.",
            "Waiting for the room connection.",
          );
  const clock = (at: number) =>
    new Date(at).toLocaleTimeString(locale === "fr" ? "fr-CH" : "en-GB");

  return (
    <>
      <section className="room-debug-route" aria-labelledby={`${id}-route`}>
        <h3 id={`${id}-route`}>
          {t("Trajet des joueurs connectés", "Connected player routes")}
        </h3>
        {diagnostics ? (
          <>
            <ul className="room-debug-peers">
              {diagnostics.peers.map((peer) => (
                <li key={peer.seat} data-own={peer.seat === ownSeat}>
                  <span className="room-debug-player">
                    {t(`Joueur ${peer.seat + 1}`, `Player ${peer.seat + 1}`)}
                    {peer.seat === ownSeat && <small>{t("Vous", "You")}</small>}
                  </span>
                  <span
                    className="room-debug-ingress"
                    title={peer.location ?? undefined}
                  >
                    <strong>
                      {peer.colo ?? t("Non exposé", "Not exposed")}
                    </strong>
                    <small>{translatedRegion(peer.region, t)}</small>
                  </span>
                  <span className="room-debug-arrow" aria-hidden="true">
                    →
                  </span>
                </li>
              ))}
            </ul>
            {!diagnostics.peers.length && (
              <p className="room-debug-note">
                {t("Aucun joueur connecté.", "No connected players.")}
              </p>
            )}
            <div className="room-debug-object">
              <strong>{diagnostics.room.className}</strong>
              <span>
                {t("SQLite dans cet objet", "SQLite inside this object")}
              </span>
            </div>
            <dl className="room-debug-host">
              <div>
                <dt>{t("Endpoint Worker", "Worker endpoint")}</dt>
                <dd>
                  {diagnostics.worker.hostname}
                  <small>{diagnostics.worker.worker}</small>
                </dd>
              </div>
              <div>
                <dt>{t("Votre entrée WebSocket", "Your WebSocket entry")}</dt>
                <dd>{socketEntry(diagnostics.worker, t)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="room-debug-empty">{roomState}</p>
        )}
      </section>
      <section className="room-debug-latency" aria-labelledby={`${id}-latency`}>
        <div className="room-debug-latency-heading">
          <h3 id={`${id}-latency`}>{t("Ping de la partie", "Game ping")}</h3>
          <strong>{formatMs(value.latencyMs)}</strong>
        </div>
        <p className="room-debug-note">
          {t(
            "Aller-retour WebSocket vers GameRoom",
            "WebSocket round trip to GameRoom",
          )}
          {" · "}
          {pingState}
        </p>
        {samples.length ? (
          <svg
            className="room-debug-chart"
            viewBox="0 0 440 108"
            role="img"
            aria-labelledby={`${id}-chart-title ${id}-chart-description`}
          >
            <title id={`${id}-chart-title`}>
              {t("Historique du ping de la partie", "Game ping history")}
            </title>
            <desc id={`${id}-chart-description`}>{chartSummary}</desc>
            <line
              x1="42"
              y1="16"
              x2="432"
              y2="16"
              className="room-debug-chart-grid"
            />
            <line
              x1="42"
              y1="84"
              x2="432"
              y2="84"
              className="room-debug-chart-grid"
            />
            <text x="0" y="20">
              {ceiling} ms
            </text>
            <text x="0" y="88">
              0 ms
            </text>
            {segments.map((segment) => (
              <polyline
                key={segment.key}
                points={segment.points.join(" ")}
                className="room-debug-chart-line"
              />
            ))}
            {samples.map((sample) => (
              <circle
                key={sample.checkedAt}
                cx={
                  42 +
                  ((sample.checkedAt - (first?.checkedAt ?? 0)) / span) * 390
                }
                cy={84 - (sample.latencyMs / ceiling) * 68}
                r="2.4"
                className="room-debug-chart-point"
              />
            ))}
            {first && (
              <text x="42" y="106">
                {clock(first.checkedAt)}
              </text>
            )}
            {last && samples.length > 1 && (
              <text x="432" y="106" textAnchor="end">
                {clock(last.checkedAt)}
              </text>
            )}
          </svg>
        ) : (
          <p className="room-debug-chart-empty">{chartSummary}</p>
        )}
        <dl
          className="room-debug-statistics"
          aria-label={t("Résumé du ping de la partie", "Game ping summary")}
        >
          <div>
            <dt>Min</dt>
            <dd>{formatMs(minimum)}</dd>
          </div>
          <div>
            <dt>{t("Moyenne", "Average")}</dt>
            <dd>{formatMs(average)}</dd>
          </div>
          <div>
            <dt>Max</dt>
            <dd>{formatMs(maximum)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
